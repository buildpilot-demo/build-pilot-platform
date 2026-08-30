import type { CSSProperties, ComponentType, SVGProps } from "react";
import {
  ConvexLogo,
  RadarIcon,
  ElevenLabsLogo,
  TwilioLogo,
  TerminalIcon,
  GitHubLogo,
  FirebaseLogo,
  WhatsAppLogo,
} from "./Icons";

// Purely decorative hero banner for the top of the Dashboard — the real
// integrations this pipeline is stitched together from, shown as a chain
// of pill "chips" with a progress rail that sweeps left to right filling
// each chip in turn. Once every chip is lit, the whole row holds for a
// moment, then clears and restarts from the beginning — a single CSS
// animation loop (see .flow-chip[data-index] rules in styles.css), no JS
// interval/animation-frame driving it.
//
// Icons are each service's actual logo (see Icons.tsx for sourcing/
// licensing), except Context.dev and Devin, which don't have a verified
// vector mark available in either open icon dataset checked — those two
// keep a generic placeholder glyph rather than guessing at a real one.
const INTEGRATIONS: ReadonlyArray<{
  key: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}> = [
  { key: "convex", label: "Convex", icon: ConvexLogo },
  { key: "contextdev", label: "Context.dev", icon: RadarIcon },
  { key: "elevenlabs", label: "ElevenLabs", icon: ElevenLabsLogo },
  { key: "twilio", label: "Twilio", icon: TwilioLogo },
  { key: "devin", label: "Devin", icon: TerminalIcon },
  { key: "github", label: "GitHub", icon: GitHubLogo },
  { key: "firebase", label: "Firebase", icon: FirebaseLogo },
  { key: "whatsapp", label: "WhatsApp", icon: WhatsAppLogo },
];

const FLOW_DURATION_S = 14;

export function FlowAnimation() {
  const trackStyle = { "--flow-duration": `${FLOW_DURATION_S}s` } as CSSProperties;

  return (
    <section className="flow-banner" aria-hidden="true">
      <div className="flow-banner__intro">
        <p className="flow-banner__caption">The pipeline, end to end</p>
        <h2 className="flow-banner__heading">
          One phone call becomes a live website — automatically.
        </h2>
      </div>
      <div className="flow-banner__track" style={trackStyle}>
        <div className="flow-banner__rail">
          <span className="flow-banner__fill" />
        </div>
        {INTEGRATIONS.map(({ key, label, icon: Icon }, index) => (
          <div key={key} className="flow-chip" data-index={index}>
            <span className="flow-chip__icon">
              <Icon />
            </span>
            <span className="flow-chip__label">{label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
