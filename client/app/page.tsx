"use client";

import { useEffect, useState, useCallback, useRef } from "react";

const API = "http://localhost:8080";

type State = {
  temperature: string | null;
  humidity: string | null;
  motion: string;
  relay: string;
  rgb: string;
  mode: string;
  status: string;
};

const COLORS = ["OFF", "RED", "GREEN", "BLUE", "WHITE", "YELLOW", "CYAN", "MAGENTA"];

const COLOR_MAP: Record<string, string> = {
  OFF:     "#1a1a2e",
  RED:     "#ff2d55",
  GREEN:   "#00ff9f",
  BLUE:    "#00b4ff",
  WHITE:   "#ffffff",
  YELLOW:  "#ffdd00",
  CYAN:    "#00ffe7",
  MAGENTA: "#ff00c8",
};

const COLOR_GLOW: Record<string, string> = {
  OFF:     "transparent",
  RED:     "#ff2d5566",
  GREEN:   "#00ff9f66",
  BLUE:    "#00b4ff66",
  WHITE:   "#ffffff44",
  YELLOW:  "#ffdd0066",
  CYAN:    "#00ffe766",
  MAGENTA: "#ff00c866",
};

function GlitchText({ text }: { text: string }) {
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <span style={{ position: "absolute", top: 0, left: "1px", color: "#ff2d55", opacity: 0.7, animation: "glitch1 3.5s infinite", clipPath: "polygon(0 30%, 100% 30%, 100% 50%, 0 50%)" }}>{text}</span>
      <span style={{ position: "absolute", top: 0, left: "-1px", color: "#00ffe7", opacity: 0.7, animation: "glitch2 3.5s infinite", clipPath: "polygon(0 60%, 100% 60%, 100% 80%, 0 80%)" }}>{text}</span>
      <span style={{ position: "relative", zIndex: 1 }}>{text}</span>
    </span>
  );
}

function ScanLine() {
  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,231,0.015) 2px, rgba(0,255,231,0.015) 4px)",
      pointerEvents: "none", zIndex: 9999,
    }} />
  );
}

function PulseOrb({ active, color = "#00ffe7" }: { active: boolean; color?: string }) {
  return (
    <div style={{ position: "relative", width: 10, height: 10 }}>
      <div style={{
        width: 10, height: 10, borderRadius: "50%",
        background: active ? color : "#333",
        boxShadow: active ? `0 0 6px ${color}, 0 0 12px ${color}` : "none",
        animation: active ? "pulseOrb 1.5s ease-in-out infinite" : "none",
      }} />
    </div>
  );
}

function TemperatureArc({ value }: { value: number | null }) {
  const r = 52;
  const cx = 70, cy = 70;
  const startAngle = -220;
  const endAngle = 40;
  const totalDeg = endAngle - startAngle;
  const pct = value != null ? Math.min(Math.max((value - 15) / 30, 0), 1) : 0;
  const deg = startAngle + pct * totalDeg;

  const toRad = (d: number) => (d * Math.PI) / 180;
  const arc = (angle: number) => ({
    x: cx + r * Math.cos(toRad(angle)),
    y: cy + r * Math.sin(toRad(angle)),
  });

  const startPt = arc(startAngle);
  const endFull = arc(endAngle);
  const endCur = arc(deg);
  const largeArc = totalDeg > 180 ? 1 : 0;
  const largeCur = pct * totalDeg > 180 ? 1 : 0;

  const trackPath = `M ${startPt.x} ${startPt.y} A ${r} ${r} 0 ${largeArc} 1 ${endFull.x} ${endFull.y}`;
  const fillPath = `M ${startPt.x} ${startPt.y} A ${r} ${r} 0 ${largeCur} 1 ${endCur.x} ${endCur.y}`;

  const hue = value != null ? Math.max(0, 240 - value * 5) : 180;
  const arcColor = `hsl(${hue}, 100%, 60%)`;

  return (
    <svg width="140" height="140" viewBox="0 0 140 140">
      <defs>
        <filter id="glow-arc">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <path d={trackPath} fill="none" stroke="#1e2a3a" strokeWidth="6" strokeLinecap="round" />
      {value != null && (
        <path d={fillPath} fill="none" stroke={arcColor} strokeWidth="6" strokeLinecap="round" filter="url(#glow-arc)" />
      )}
      <text x="70" y="65" textAnchor="middle" fill="#e0f0ff" fontSize="22" fontWeight="700" fontFamily="'Courier New', monospace">
        {value != null ? `${value.toFixed(1)}°` : "—"}
      </text>
      <text x="70" y="84" textAnchor="middle" fill="#4a7a9b" fontSize="10" fontFamily="'Courier New', monospace" letterSpacing="2">
        TEMP
      </text>
    </svg>
  );
}

function HumidityBar({ value }: { value: number | null }) {
  const pct = value != null ? Math.min(Math.max(value / 100, 0), 1) : 0;
  const bars = 12;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 48 }}>
        {Array.from({ length: bars }).map((_, i) => {
          const barPct = (i + 1) / bars;
          const lit = barPct <= pct;
          const h = 16 + i * 2.5;
          return (
            <div key={i} style={{
              width: 6, height: h,
              background: lit ? `hsl(${190 + i * 4}, 100%, ${50 + i * 2}%)` : "#1a2535",
              borderRadius: 2,
              boxShadow: lit ? `0 0 6px hsl(${190 + i * 4}, 100%, 60%)` : "none",
              transition: "all 0.4s ease",
            }} />
          );
        })}
      </div>
      <div style={{ fontFamily: "'Courier New', monospace", fontSize: 11, color: "#4a7a9b", letterSpacing: 2 }}>
        HUMIDITY <span style={{ color: "#00ffe7", fontWeight: 700 }}>{value != null ? `${value}%` : "—"}</span>
      </div>
    </div>
  );
}

function MotionDetector({ active }: { active: boolean }) {
  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div style={{ position: "relative", width: 60, height: 60 }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            position: "absolute",
            top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            width: 20 + i * 16, height: 20 + i * 16,
            borderRadius: "50%",
            border: `1px solid ${active ? "#ff2d55" : "#1e2a3a"}`,
            opacity: active ? 1 - i * 0.25 : 0.3,
            animation: active ? `sonar 1.5s ease-out ${i * 0.5}s infinite` : "none",
            transition: "all 0.5s ease",
          }} />
        ))}
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          width: 14, height: 14, borderRadius: "50%",
          background: active ? "#ff2d55" : "#1e2a3a",
          boxShadow: active ? "0 0 8px #ff2d55, 0 0 20px #ff2d5555" : "none",
          transition: "all 0.5s ease",
        }} />
      </div>
      <div style={{ fontFamily: "'Courier New', monospace", fontSize: 10, letterSpacing: 2, color: active ? "#ff2d55" : "#2a3a4a" }}>
        {active ? "MOTION DETECTED" : "CLEAR"}
      </div>
    </div>
  );
}

function RGBOrb({ color }: { color: string }) {
  const hex = COLOR_MAP[color] ?? "#1a1a2e";
  const glow = COLOR_GLOW[color] ?? "transparent";
  return (
    <div style={{
      width: 48, height: 48, borderRadius: "50%",
      background: color === "OFF"
        ? "radial-gradient(circle at 35% 35%, #2a2a4a, #0a0a1e)"
        : `radial-gradient(circle at 35% 35%, ${hex}cc, ${hex}44)`,
      boxShadow: color !== "OFF" ? `0 0 16px ${glow}, 0 0 32px ${glow}` : "inset 0 0 12px #000",
      border: `1px solid ${color !== "OFF" ? hex + "88" : "#1e2a3a"}`,
      transition: "all 0.4s ease",
      flexShrink: 0,
    }} />
  );
}

export default function Home() {
  const [state, setState] = useState<State | null>(null);
  const [rgbInput, setRgbInput] = useState("OFF");
  const [tick, setTick] = useState(0);
  const canvasRef = useRef<HTMLDivElement>(null);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch(`${API}/state`);
      const data = await res.json();
      setState(data);
      setRgbInput(prev => prev === data.rgb ? prev : data.rgb);
    } catch { /* offline */ }
  }, []);

  useEffect(() => {
    fetchState();
    const id = setInterval(fetchState, 2000);
    const t = setInterval(() => setTick(n => n + 1), 80);
    return () => { clearInterval(id); clearInterval(t); };
  }, [fetchState]);

  const post = (path: string, body: object) =>
    fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(fetchState);

  const toggleRelay = () => post("/relay", { state: state?.relay === "ON" ? "OFF" : "ON" });
  const setMode = (mode: string) => post("/mode", { mode });
  const setRgb = (color: string) => { setRgbInput(color); post("/rgb", { color }); };

  const online = state?.status === "ONLINE";
  const temp = state?.temperature ? parseFloat(state.temperature) : null;
  const humidity = state?.humidity ? parseFloat(state.humidity) : null;
  const motionActive = state?.motion === "1";
  const relayOn = state?.relay === "ON";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Orbitron:wght@400;700;900&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }

        @keyframes glitch1 {
          0%, 90%, 100% { transform: translateX(0); opacity: 0; }
          92% { transform: translateX(-2px); opacity: 0.7; }
          94% { transform: translateX(2px); opacity: 0.5; }
          96% { transform: translateX(0); opacity: 0; }
        }
        @keyframes glitch2 {
          0%, 85%, 100% { transform: translateX(0); opacity: 0; }
          87% { transform: translateX(2px); opacity: 0.7; }
          89% { transform: translateX(-2px); opacity: 0.5; }
          91% { transform: translateX(0); opacity: 0; }
        }
        @keyframes pulseOrb {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.4); opacity: 0.6; }
        }
        @keyframes sonar {
          0% { transform: translate(-50%, -50%) scale(1); opacity: 0.8; }
          100% { transform: translate(-50%, -50%) scale(2); opacity: 0; }
        }
        @keyframes scanBeam {
          0% { top: -2px; }
          100% { top: 100%; }
        }
        @keyframes blink {
          0%, 100% { opacity: 1; } 50% { opacity: 0; }
        }
        @keyframes borderFlow {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes floatCard {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-3px); }
        }
        .panel {
          background: linear-gradient(135deg, #0a0f1e 0%, #0d1525 50%, #080d1a 100%);
          border: 1px solid #1e3a5a44;
          border-radius: 12px;
          position: relative;
          overflow: hidden;
          animation: fadeSlideIn 0.5s ease both;
        }
        .panel::before {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: 12px;
          padding: 1px;
          background: linear-gradient(135deg, #00ffe722, #00b4ff11, #ff2d5511, #00ffe722);
          background-size: 300% 300%;
          animation: borderFlow 4s ease infinite;
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
          pointer-events: none;
        }
        .panel::after {
          content: "";
          position: absolute;
          left: 0; right: 0; height: 1px;
          background: linear-gradient(90deg, transparent, #00ffe733, transparent);
          animation: scanBeam 4s linear infinite;
          pointer-events: none;
        }
        .rgb-chip {
          padding: 5px 12px;
          border-radius: 20px;
          border: 1px solid #1e3a5a;
          font-family: 'Share Tech Mono', monospace;
          font-size: 11px;
          cursor: pointer;
          transition: all 0.25s ease;
          background: #0a0f1e;
          color: #4a7a9b;
          letter-spacing: 1px;
        }
        .rgb-chip:hover { border-color: #00ffe744; color: #00ffe7; }
        .rgb-chip.active {
          color: #fff;
          border-color: var(--chip-color, #00ffe7);
          background: color-mix(in srgb, var(--chip-color, #00ffe7) 12%, transparent);
          box-shadow: 0 0 10px color-mix(in srgb, var(--chip-color, #00ffe7) 40%, transparent);
        }
        .mode-btn {
          flex: 1;
          padding: 10px 0;
          border: 1px solid #1e3a5a;
          background: transparent;
          border-radius: 8px;
          font-family: 'Share Tech Mono', monospace;
          font-size: 12px;
          letter-spacing: 2px;
          color: #4a7a9b;
          cursor: pointer;
          transition: all 0.25s ease;
        }
        .mode-btn.active {
          background: linear-gradient(135deg, #00ffe711, #00b4ff11);
          border-color: #00ffe766;
          color: #00ffe7;
          box-shadow: 0 0 12px #00ffe722, inset 0 0 12px #00ffe708;
        }
        .mode-btn:hover:not(.active) { border-color: #2e4a6a; color: #6a9abb; }
        .relay-ring {
          width: 64px; height: 64px; border-radius: 50%;
          border: 2px solid;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          transition: all 0.35s ease;
          position: relative;
          overflow: hidden;
        }
        .relay-ring::before {
          content: "";
          position: absolute; inset: 4px;
          border-radius: 50%;
          transition: all 0.35s ease;
        }
      `}</style>

      <ScanLine />

      <main style={{
        minHeight: "100vh",
        background: "radial-gradient(ellipse at 20% 20%, #0a1628 0%, #050810 50%, #020508 100%)",
        padding: "24px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        fontFamily: "'Share Tech Mono', monospace",
      }}>

        {/* HEADER */}
        <div style={{ animation: "fadeSlideIn 0.4s ease both" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <div>
              <div style={{ fontSize: 10, letterSpacing: 4, color: "#4a7a9b", marginBottom: 4 }}>
                SMART ENVIRONMENT CONTROL
              </div>
              <h1 style={{
                fontFamily: "'Orbitron', monospace",
                fontSize: 28,
                fontWeight: 900,
                color: "#e0f0ff",
                letterSpacing: 3,
                lineHeight: 1,
              }}>
                <GlitchText text="ROOM 01" />
              </h1>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end",
                padding: "6px 14px", borderRadius: 20,
                background: online ? "#00ff9f0d" : "#ff2d550d",
                border: `1px solid ${online ? "#00ff9f33" : "#ff2d5533"}`,
                marginBottom: 4,
              }}>
                <PulseOrb active={online} color={online ? "#00ff9f" : "#ff2d55"} />
                <span style={{
                  fontSize: 11, letterSpacing: 2,
                  color: online ? "#00ff9f" : "#ff2d55",
                  fontFamily: "'Orbitron', monospace",
                }}>
                  {state?.status ?? "OFFLINE"}
                </span>
              </div>
              <div style={{ fontSize: 9, color: "#2a4a6a", letterSpacing: 1 }}>
                {online ? "SYS NOMINAL" : "CONNECTION LOST"}
              </div>
            </div>
          </div>

          {/* Ticker */}
          <div style={{
            marginTop: 10,
            padding: "4px 12px",
            background: "#0a0f1e",
            border: "1px solid #1e3a5a44",
            borderRadius: 4,
            fontSize: 9, color: "#2a5a7a", letterSpacing: 2,
            overflow: "hidden", whiteSpace: "nowrap",
          }}>
            {">>> MONITORING ACTIVE  //  AUTO-REFRESH 2s  //  SENSORS NOMINAL  //  NODE v1.4.2  //  ".repeat(3)}
            <span style={{ animation: "blink 1s step-start infinite", color: "#00ffe7" }}>█</span>
          </div>
        </div>

        {/* SENSORS ROW */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {/* Temp */}
          <div className="panel" style={{ padding: "16px", animationDelay: "0.1s", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ fontSize: 9, letterSpacing: 3, color: "#4a7a9b", marginBottom: 4, alignSelf: "flex-start" }}>
              THERMAL
            </div>
            <TemperatureArc value={temp} />
          </div>

          {/* Humidity + Motion */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="panel" style={{ padding: "16px", animationDelay: "0.15s", flex: 1 }}>
              <div style={{ fontSize: 9, letterSpacing: 3, color: "#4a7a9b", marginBottom: 10 }}>MOISTURE</div>
              <HumidityBar value={humidity} />
            </div>
            <div className="panel" style={{ padding: "16px", animationDelay: "0.2s", flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <MotionDetector active={motionActive} />
            </div>
          </div>
        </div>

        {/* RELAY */}
        <div className="panel" style={{ padding: "20px 24px", animationDelay: "0.25s" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 9, letterSpacing: 3, color: "#4a7a9b", marginBottom: 6 }}>POWER RELAY</div>
              <div style={{ fontSize: 10, color: "#2a4a6a", marginBottom: 2 }}>
                {relayOn ? "CIRCUIT CLOSED — ACTIVE" : "CIRCUIT OPEN — STANDBY"}
              </div>
              <div style={{
                fontFamily: "'Orbitron', monospace",
                fontSize: 18, fontWeight: 700,
                color: relayOn ? "#00ff9f" : "#ff2d55",
                textShadow: relayOn ? "0 0 12px #00ff9f88" : "0 0 12px #ff2d5588",
              }}>
                {state?.relay ?? "—"}
              </div>
            </div>
            <div
              className="relay-ring"
              onClick={toggleRelay}
              style={{
                borderColor: relayOn ? "#00ff9f" : "#ff2d55",
                boxShadow: relayOn
                  ? "0 0 12px #00ff9f55, 0 0 24px #00ff9f22, inset 0 0 12px #00ff9f11"
                  : "0 0 12px #ff2d5544, inset 0 0 8px #ff2d5508",
              }}
            >
              <div style={{
                width: "100%", height: "100%",
                borderRadius: "50%",
                position: "absolute", inset: 4,
                background: relayOn
                  ? "radial-gradient(circle, #00ff9f22, transparent)"
                  : "radial-gradient(circle, #ff2d5511, transparent)",
              }} />
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M12 2v6M12 2l3 3M12 2l-3 3" stroke={relayOn ? "#00ff9f" : "#ff2d55"} strokeWidth="1.5" strokeLinecap="round" />
                <path d="M5.5 7A8 8 0 1 0 18.5 7" stroke={relayOn ? "#00ff9f" : "#ff2d55"} strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
          </div>

          {/* Power bar */}
          <div style={{ marginTop: 14, height: 3, background: "#0d1525", borderRadius: 2, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 2,
              width: relayOn ? "100%" : "0%",
              background: relayOn
                ? "linear-gradient(90deg, #00ff9f44, #00ff9f, #00ffe7)"
                : "transparent",
              transition: "width 0.6s ease",
              boxShadow: relayOn ? "0 0 8px #00ff9f" : "none",
            }} />
          </div>
        </div>

        {/* RGB */}
        <div className="panel" style={{ padding: "20px 24px", animationDelay: "0.3s" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 9, letterSpacing: 3, color: "#4a7a9b", marginBottom: 6 }}>CHROMATIC OUTPUT</div>
              <div style={{
                fontFamily: "'Orbitron', monospace", fontSize: 16, fontWeight: 700,
                color: state?.rgb === "OFF" ? "#2a4a6a" : (COLOR_MAP[state?.rgb ?? "OFF"] ?? "#fff"),
                textShadow: state?.rgb !== "OFF" ? `0 0 10px ${COLOR_MAP[state?.rgb ?? "OFF"] ?? "#fff"}` : "none",
              }}>
                {state?.rgb ?? "—"}
              </div>
            </div>
            <RGBOrb color={state?.rgb ?? "OFF"} />
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setRgb(c)}
                className={`rgb-chip ${rgbInput === c ? "active" : ""}`}
                style={{ "--chip-color": COLOR_MAP[c] } as React.CSSProperties}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* MODE */}
        <div className="panel" style={{ padding: "20px 24px", animationDelay: "0.35s" }}>
          <div style={{ fontSize: 9, letterSpacing: 3, color: "#4a7a9b", marginBottom: 14 }}>OPERATION MODE</div>
          <div style={{ display: "flex", gap: 10 }}>
            {["AUTO", "MANUAL"].map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`mode-btn ${state?.mode === m ? "active" : ""}`}
              >
                {m === "AUTO" ? "⟳ AUTO" : "◈ MANUAL"}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 10, fontSize: 9, color: "#2a4a6a", letterSpacing: 1 }}>
            {state?.mode === "AUTO"
              ? "SYSTEM MANAGING ENVIRONMENT AUTOMATICALLY"
              : "MANUAL OVERRIDE ACTIVE — USER CONTROL"}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          textAlign: "center", fontSize: 8, color: "#1a2a3a",
          letterSpacing: 3, paddingBottom: 8,
          animation: "fadeSlideIn 0.5s ease 0.5s both",
        }}>
          NEXUS ROOM CONTROL  //  BUILD 2025.1  //  SECURED
        </div>
      </main>
    </>
  );
}