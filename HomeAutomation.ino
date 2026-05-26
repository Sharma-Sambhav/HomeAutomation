#include <DHT.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include "secrets.h"

#define PIN_RED    27
#define PIN_GREEN  25
#define PIN_BLUE   26
#define PIN_RELAY  23
#define PIN_DHT    22
#define PIN_MOTION 14

#define DHT_TYPE         DHT11
#define MOTION_TIMEOUT   6000UL   // ms before auto-off
#define DHT_INTERVAL     2000UL   // ms between sensor reads
#define MQTT_RETRY_DELAY 2000UL   // ms between reconnect attempts

// =================================================
// TOPICS — single source of truth
// =================================================

#define T_STATUS    "home/room1/status"
#define T_TEMP      "home/room1/temperature"
#define T_HUM       "home/room1/humidity"
#define T_MOTION    "home/room1/motion"
#define T_RELAY_ST  "home/room1/relay/state"
#define T_RELAY_SET "home/room1/relay/set"
#define T_RGB_ST    "home/room1/rgb/state"
#define T_RGB_SET   "home/room1/rgb/set"
#define T_MODE      "home/room1/mode"
#define T_MODE_SET  "home/room1/mode/set"

// =================================================
// RGB — common-anode: LOW = ON
// =================================================

struct RGBColor { bool r, g, b; };

// Indexed by LED_* constants
static const RGBColor RGB_TABLE[] = {
  // r      g      b
  { false, false, false },  // OFF
  { true,  false, false },  // RED
  { false, true,  false },  // GREEN
  { false, false, true  },  // BLUE
  { false, false, false },  // WHITE — all on
  { true,  true,  false },  // YELLOW
  { false, true,  true  },  // CYAN
  { true,  false, true  },  // MAGENTA
};

enum LedColor : uint8_t {
  LED_OFF = 0, LED_RED, LED_GREEN, LED_BLUE,
  LED_WHITE,   LED_YELLOW, LED_CYAN, LED_MAGENTA
};

// String → enum for MQTT parsing (avoid long if-chains)
struct ColorEntry { const char* name; LedColor color; };
static const ColorEntry COLOR_MAP[] = {
  { "RED",     LED_RED     },
  { "GREEN",   LED_GREEN   },
  { "BLUE",    LED_BLUE    },
  { "YELLOW",  LED_YELLOW  },
  { "CYAN",    LED_CYAN    },
  { "MAGENTA", LED_MAGENTA },
  { "WHITE",   LED_WHITE   },
};
static const uint8_t COLOR_MAP_LEN =
  sizeof(COLOR_MAP) / sizeof(COLOR_MAP[0]);

// =================================================
// STATE — all mutable state in one place
// =================================================

static struct {
  bool     auto_mode          = true;
  bool     relay              = false;
  bool     room_occupied      = false;
  bool     last_motion        = false;
  LedColor led                = LED_OFF;
  uint32_t last_motion_time   = 0;
  uint32_t last_dht_time      = 0;
  float    last_temp          = NAN;
  float    last_hum           = NAN;
} S;

// =================================================
// OBJECTS
// =================================================

static DHT            dht(PIN_DHT, DHT_TYPE);
static WiFiClientSecure espClient;
static PubSubClient   mqtt(espClient);

// =================================================
// HELPERS
// =================================================

// Publish a retained string topic
inline void pub(const char* topic, const char* payload) {
  mqtt.publish(topic, payload, true);
}

// Publish a retained float, rounded to 1 decimal place
void pub_float(const char* topic, float v) {
  char buf[12];
  dtostrf(v, 4, 1, buf);
  // trim leading spaces
  const char* p = buf;
  while (*p == ' ') p++;
  pub(topic, p);
}

// Set RGB LED (common anode)
void set_led(LedColor color) {
  if (S.led == color) return;            // skip redundant writes
  S.led = color;

  // Safe fallback for LED_WHITE (all LOW)
  const RGBColor& c = (color == LED_WHITE)
    ? (RGBColor){ true, true, true }
    : RGB_TABLE[color];

  // Common anode: HIGH = off, LOW = on
  digitalWrite(PIN_RED,   c.r ? LOW : HIGH);
  digitalWrite(PIN_GREEN, c.g ? LOW : HIGH);
  digitalWrite(PIN_BLUE,  c.b ? LOW : HIGH);
}

// Parse color string → LedColor, returns LED_OFF on unknown
LedColor parse_color(const String& s) {
  for (uint8_t i = 0; i < COLOR_MAP_LEN; i++) {
    if (s == COLOR_MAP[i].name) return COLOR_MAP[i].color;
  }
  return LED_OFF;
}

// Set relay with guard + publish
void set_relay(bool on) {
  if (S.relay == on) return;
  S.relay = on;
  digitalWrite(PIN_RELAY, on ? LOW : HIGH);  // active-low relay
  pub(T_RELAY_ST, on ? "ON" : "OFF");
  Serial.printf("[RELAY] %s\n", on ? "ON" : "OFF");
}

// =================================================
// WIFI
// =================================================

void connect_wifi() {
  Serial.printf("\n[WiFi] Connecting to %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  uint8_t attempts = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    if (++attempts > 40) {
      Serial.println("\n[WiFi] Timeout — restarting");
      ESP.restart();
    }
  }
  Serial.printf("\n[WiFi] Connected  IP: %s\n",
                WiFi.localIP().toString().c_str());
}

// =================================================
// MQTT CALLBACK
// =================================================

void mqtt_callback(char* topic, byte* payload, unsigned int len) {
  // Build message string once
  char buf[64];
  uint8_t copy = min((unsigned int)(sizeof(buf) - 1), len);
  memcpy(buf, payload, copy);
  buf[copy] = '\0';
  const String msg(buf);

  Serial.printf("[MQTT] ← %s : %s\n", topic, buf);

  // --- MODE ---
  if (strcmp(topic, T_MODE_SET) == 0) {
    if (msg == "AUTO" || msg == "MANUAL") {
      S.auto_mode = (msg == "AUTO");
      pub(T_MODE, buf);
      Serial.printf("[MODE] %s\n", buf);
    }
    return;
  }

  // --- RELAY (manual only) ---
  if (strcmp(topic, T_RELAY_SET) == 0 && !S.auto_mode) {
    if (msg == "ON")  set_relay(true);
    if (msg == "OFF") set_relay(false);
    return;
  }

  // --- RGB ---
  if (strcmp(topic, T_RGB_SET) == 0) {
    LedColor c = parse_color(msg);
    set_led(c);
    pub(T_RGB_ST, buf);    // echo back whatever was sent (OFF or color name)
    return;
  }
}

// =================================================
// MQTT CONNECT
// =================================================

void connect_mqtt() {
  while (!mqtt.connected()) {
    Serial.print("[MQTT] Connecting…");

    bool ok = mqtt.connect(
      MQTT_CLIENT_ID,
      MQTT_USER, MQTT_PASS,
      T_STATUS, 0, true, "OFFLINE"  // LWT
    );

    if (ok) {
      Serial.println(" connected");
      pub(T_STATUS, "ONLINE");
      mqtt.subscribe(T_RELAY_SET);
      mqtt.subscribe(T_RGB_SET);
      mqtt.subscribe(T_MODE_SET);
    } else {
      Serial.printf(" failed (state=%d) — retry in %lums\n",
                    mqtt.state(), MQTT_RETRY_DELAY);
      delay(MQTT_RETRY_DELAY);
    }
  }
}

// =================================================
// SETUP
// =================================================

void setup() {
  Serial.begin(115200);
  delay(200);

  pinMode(PIN_RED,    OUTPUT);
  pinMode(PIN_GREEN,  OUTPUT);
  pinMode(PIN_BLUE,   OUTPUT);
  pinMode(PIN_RELAY,  OUTPUT);
  pinMode(PIN_MOTION, INPUT);

  // Safe initial hardware state
  set_relay(false);
  set_led(LED_OFF);

  dht.begin();

  connect_wifi();

  espClient.setInsecure();   // production: supply CA cert instead
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(mqtt_callback);
  mqtt.setKeepAlive(30);     // heartbeat every 30 s

  connect_mqtt();
}

// =================================================
// LOOP
// =================================================

void loop() {
  // Maintain MQTT connection
  if (!mqtt.connected()) connect_mqtt();
  mqtt.loop();

  const uint32_t now = millis();

  // -----------------------------------------------
  // AUTO MODE — motion-based relay control
  // -----------------------------------------------
  if (S.auto_mode) {
    const bool motion = (digitalRead(PIN_MOTION) == HIGH);

    // Rising edge
    if (motion && !S.last_motion) {
      pub(T_MOTION, "1");
      S.last_motion = true;
      S.room_occupied = true;
      S.last_motion_time = now;
      set_relay(true);
    }

    // Falling edge
    if (!motion && S.last_motion) {
      pub(T_MOTION, "0");
      S.last_motion = false;
    }

    // Update timestamp while motion is still active
    if (motion) S.last_motion_time = now;

    // Timeout — no motion for MOTION_TIMEOUT ms
    if (S.room_occupied &&
        (now - S.last_motion_time >= MOTION_TIMEOUT)) {
      Serial.println("[AUTO] Motion timeout — relay off");
      S.room_occupied = false;
      set_relay(false);
    }
  }

  // -----------------------------------------------
  // DHT SENSOR — non-blocking read every DHT_INTERVAL
  // -----------------------------------------------
  if (now - S.last_dht_time >= DHT_INTERVAL) {
    S.last_dht_time = now;

    const float h = dht.readHumidity();
    const float t = dht.readTemperature();

    if (isnan(h) || isnan(t)) {
      Serial.println("[DHT] Read failed");
      return;
    }

    // Only publish if values actually changed (saves bandwidth)
    if (t != S.last_temp) {
      S.last_temp = t;
      pub_float(T_TEMP, t);
      Serial.printf("[DHT] Temp: %.1f°C\n", t);
    }
    if (h != S.last_hum) {
      S.last_hum = h;
      pub_float(T_HUM, h);
      Serial.printf("[DHT] Hum:  %.1f%%\n", h);
    }
  }
}
