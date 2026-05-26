import 'dotenv/config';
import mqtt from 'mqtt';
import express from 'express';
import cors from 'cors';

const app = express();

app.use(cors());
app.use(express.json());

// --------------------------------------------------
// MQTT CONFIG
// --------------------------------------------------

const mqttClient = mqtt.connect(process.env.MQTT_HOST, {
  port: Number(process.env.MQTT_PORT),
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  rejectUnauthorized: false
});

// --------------------------------------------------
// LIVE DEVICE STATE
// --------------------------------------------------

const deviceState = {
  temperature: null,
  humidity: null,
  motion: '0',
  relay: 'OFF',
  rgb: 'OFF',
  mode: 'AUTO',
  status: 'OFFLINE'
};

// --------------------------------------------------
// MQTT CONNECT
// --------------------------------------------------

mqttClient.on('connect', () => {

  console.log('Connected to MQTT broker');

  // --------------------------------------------
  // SUBSCRIBE TO ALL ESP32 TOPICS
  // --------------------------------------------

  mqttClient.subscribe('home/room1/#');

});

// --------------------------------------------------
// MQTT MESSAGE RECEIVE
// --------------------------------------------------

mqttClient.on('message', (topic, message) => {

  const value = message.toString();

  console.log(topic, value);

  // --------------------------------------------
  // SENSOR DATA
  // --------------------------------------------

  if (topic === 'home/room1/temperature') {

    deviceState.temperature = value;
  }

  else if (topic === 'home/room1/humidity') {

    deviceState.humidity = value;
  }

  else if (topic === 'home/room1/motion') {

    deviceState.motion = value;
  }

  // --------------------------------------------
  // DEVICE STATES
  // --------------------------------------------

  else if (topic === 'home/room1/relay/state') {

    deviceState.relay = value;
  }

  else if (topic === 'home/room1/rgb/state') {

    deviceState.rgb = value;
  }

  else if (topic === 'home/room1/mode') {

    deviceState.mode = value;
  }

  else if (topic === 'home/room1/status') {

    deviceState.status = value;
  }
});

// --------------------------------------------------
// MQTT ERROR
// --------------------------------------------------

mqttClient.on('error', (err) => {

  console.error('MQTT Error:', err);
});

// --------------------------------------------------
// GET LIVE SENSOR DATA
// --------------------------------------------------

app.get('/state', (req, res) => {

  res.json(deviceState);
});

// --------------------------------------------------
// RELAY CONTROL
// --------------------------------------------------

app.post('/relay', (req, res) => {

  const { state } = req.body;

  mqttClient.publish(
    'home/room1/relay/set',
    state
  );

  res.json({
    success: true
  });
});

// --------------------------------------------------
// RGB CONTROL
// --------------------------------------------------

app.post('/rgb', (req, res) => {

  const { color } = req.body;

  mqttClient.publish(
    'home/room1/rgb/set',
    color
  );

  res.json({
    success: true
  });
});

// --------------------------------------------------
// MODE CONTROL
// --------------------------------------------------

app.post('/mode', (req, res) => {

  const { mode } = req.body;

  mqttClient.publish(
    'home/room1/mode/set',
    mode
  );

  res.json({
    success: true
  });
});

// --------------------------------------------------
// SERVER
// --------------------------------------------------

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {

  console.log(`Server running on port ${PORT}`);
});