/**
 * PLURACON Startup Banner
 * ----------------------
 * Zeigt beim Start von pi ein PLURACON-ASCII-Art-Banner mit animiertem
 * Farbverlauf (Blau → Gelb → Rot → Orange) als TUI-Overlay an.
 *
 * Portiert aus dem PowerShell-Skript "pluracon-banner.ps1" (UTF-8 mit BOM).
 * Das Banner bleibt ~2 Sekunden sichtbar und blendet anschließend über
 * ~3 Sekunden sanft aus (insgesamt max. 5 Sekunden auf dem Bildschirm).
 * Es nimmt keinen Tastatur-Fokus — Tippen im Editor funktioniert sofort weiter.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

// ── ASCII-Art (1:1 aus dem PowerShell-Skript übernommen) ───────────────────
const ASCII_ART = [
	"██████╗ ██╗     ██╗   ██╗██████╗  █████╗  ██████╗ ██████╗ ███╗   ██╗",
	"██╔══██╗██║     ██║   ██║██╔══██╗██╔══██╗██╔════╝██╔═══██╗████╗  ██║",
	"██████╔╝██║     ██║   ██║██████╔╝███████║██║     ██║   ██║██╔██╗ ██║",
	"██╔═══╝ ██║     ██║   ██║██╔══██╗██╔══██║██║     ██║   ██║██║╚██╗██║",
	"██║     ███████╗╚██████╔╝██║  ██║██║  ██║╚██████╗╚██████╔╝██║ ╚████║",
	"╚═╝     ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝",
];

// ── Farbverlauf-Stops (identisch zum PowerShell-Skript) ─────────────────────
const COLOR_STOPS: ReadonlyArray<readonly [number, number, number]> = [
	[0, 102, 255], // Blau
	[255, 255, 0], // Gelb
	[255, 0, 0], // Rot
	[255, 140, 0], // Orange
];

// Breite der breitesten Zeile
const ART_WIDTH = Math.max(...ASCII_ART.map((line) => line.length));

// Anzeige-Lebenszyklus (gesamte Anzeigedauer ≤ 5 Sekunden)
const SHOW_MS = 2000; // Volle Sichtbarkeit
const FADE_MS = 3000; // Dauer des Fadeouts
const WAVE_MS = 75; // Geschwindigkeit der Farbwelle
const FRAME_MS = 33; // Render-Takt (~30 FPS, für weichen Fadeout)

/** Lineare Interpolation zwischen zwei Werten (gerundet). */
function lerp(start: number, end: number, t: number): number {
	return Math.round(start + (end - start) * t);
}

/**
 * RGB-Werte für die Position t ∈ [0, 1] entlang des Farbverlaufs
 * Blau → Gelb → Rot → Orange (wie im PowerShell-Skript).
 */
function gradientRgb(t: number): [number, number, number] {
	let r: number, g: number, b: number;
	if (t <= 0.33) {
		const localT = t / 0.33;
		r = lerp(COLOR_STOPS[0][0], COLOR_STOPS[1][0], localT);
		g = lerp(COLOR_STOPS[0][1], COLOR_STOPS[1][1], localT);
		b = lerp(COLOR_STOPS[0][2], COLOR_STOPS[1][2], localT);
	} else if (t <= 0.66) {
		const localT = (t - 0.33) / 0.33;
		r = lerp(COLOR_STOPS[1][0], COLOR_STOPS[2][0], localT);
		g = lerp(COLOR_STOPS[1][1], COLOR_STOPS[2][1], localT);
		b = lerp(COLOR_STOPS[1][2], COLOR_STOPS[2][2], localT);
	} else {
		const localT = (t - 0.66) / 0.34;
		r = lerp(COLOR_STOPS[2][0], COLOR_STOPS[3][0], localT);
		g = lerp(COLOR_STOPS[2][1], COLOR_STOPS[3][1], localT);
		b = lerp(COLOR_STOPS[2][2], COLOR_STOPS[3][2], localT);
	}
	return [r, g, b];
}

/** True-Color-ANSI-Sequenz für eine RGB-Farbe. */
function rgbToAnsi(r: number, g: number, b: number): string {
	return `\x1b[38;2;${r};${g};${b}m`;
}

/**
 * Mischt eine Vorder- (Farbe) in eine Ziel-Farbe (Hintergrund).
 * alpha = 1 → reine Farbe, alpha = 0 → reine Ziel-Farbe (unsichtbar).
 */
function blendDelay(rgb: readonly [number, number, number], target: readonly [number, number, number], alpha: number): [number, number, number] {
	return [
		Math.round(rgb[0] * alpha + target[0] * (1 - alpha)),
		Math.round(rgb[1] * alpha + target[1] * (1 - alpha)),
		Math.round(rgb[2] * alpha + target[2] * (1 - alpha)),
	];
}

/**
 * TUI-Komponente für das PLURACON-Banner.
 *
 * - Zeile für Zeile mit horizontalem Farbverlauf wie im PowerShell-Skript
 * - Farbwelle wandert von links nach rechts (Offset aus verstrichener Zeit)
 * - Nach SHOW_MS startet ein Fadeout über FADE_MS hin zur Hintergrundfarbe
 * - Schließt sich nach SHOW_MS + FADE_MS automatisch (insgesamt ≤ 5 s)
 */
class PluraconBanner implements Component {
	private tui: TUI;
	private done: () => void;
	private closed = false;
	private startTime = Date.now();
	// Terminal-Hintergrundfarbe; Fallback Schwarz, falls die Abfrage fehlschlägt
	private bg: [number, number, number] = [0, 0, 0];
	private frameTimer: ReturnType<typeof setInterval> | null = null;

	constructor(tui: TUI, done: () => void) {
		this.tui = tui;
		this.done = done;

		// Echte Hintergrundfarbe ermitteln, damit der Fadeout ins Bild übergeht
		tui
			.queryTerminalBackgroundColor({ timeoutMs: 800 })
			.then((color) => {
				if (color) this.bg = [color.r, color.g, color.b];
			})
			.catch(() => {
				// Fallback bleibt Schwarz
			});

		// Animations-Takt: Farbwelle + Fadeout gleichermaßen
		this.frameTimer = setInterval(() => {
			if (Date.now() >= this.startTime + SHOW_MS + FADE_MS) {
				this.close();
				return;
			}
			this.tui.requestRender();
		}, FRAME_MS);
	}

	handleInput(): void {
		// Über "nonCapturing" erhält die Komponente normalerweise keinen Input.
		// Falls doch (z. B. wenn jemand das Overlay fokussiert): sofort schließen.
		this.close();
	}

	invalidate(): void {
		// Kein gecachter Zustand → nichts zu tun
	}

	render(width: number): string[] {
		if (width < ART_WIDTH + 4) return []; // Terminal zu schmal → nicht zeichnen

		const elapsed = Date.now() - this.startTime;

		// Ausblend-Faktor: 1 = voll sichtbar, 0 = komplett ausgeblendet
		let alpha = 1;
		if (elapsed > SHOW_MS) {
			alpha = Math.max(0, 1 - (elapsed - SHOW_MS) / FADE_MS);
		}

		// Wellen-Offset aus der verstrichenen Zeit ableiten (frequenzunabhängig)
		const offset = Math.floor(elapsed / WAVE_MS) % ART_WIDTH;
		const padLeft = Math.max(0, Math.floor((width - ART_WIDTH) / 2));

		return ASCII_ART.map((line) => {
			let out = "";
			for (let i = 0; i < line.length; i++) {
				// Horizontaler Verlauf wie im Skript, plus Offset für die Welle.
				// i - offset lässt das Muster nach rechts wandern (links → rechts).
				const t = (((i - offset) % ART_WIDTH) + ART_WIDTH) % ART_WIDTH / ART_WIDTH;
				const rgb = gradientRgb(t);
				const [r, g, b] = blendDelay(rgb, this.bg, alpha);
				out += rgbToAnsi(r, g, b) + line[i];
			}
			return " ".repeat(padLeft) + out;
		});
	}

	dispose(): void {
		this.close();
	}

	private close(): void {
		if (this.closed) return;
		this.closed = true;
		if (this.frameTimer) clearInterval(this.frameTimer);
		this.frameTimer = null;
		this.done();
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", (event, ctx) => {
		// Nur beim echten Start von pi anzeigen, nicht bei /new, /resume, /fork oder /reload
		if (event.reason !== "startup") return;
		// Nur im interaktiven TUI-Modus
		if (ctx.mode !== "tui") return;

		// Fire-and-forget: Startvorgang nicht blockieren, Banner schließt sich selbst
		ctx.ui
			.custom<void>(
				(tui, _theme, _kb, done) => new PluraconBanner(tui, () => done(undefined)),
				{
					overlay: true,
					overlayOptions: {
						width: "100%",
						anchor: "center",
						// Kein Tastatur-Fokus: Tippen geht sofort an den Editor
						nonCapturing: true,
						// Auf sehr schmalen Terminals ausblenden
						visible: (termWidth, termHeight) =>
							termWidth >= ART_WIDTH + 4 && termHeight >= 10,
					},
				},
			)
			.catch(() => {
				// Overlay-Fehler ignorieren — das Banner ist rein dekorativ
			});
	});
}