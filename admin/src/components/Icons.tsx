import type { SVGProps } from "react";

const base = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
export const GridIcon = (props: SVGProps<SVGSVGElement>) => <svg {...base} {...props}><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>;
export const SearchIcon = (props: SVGProps<SVGSVGElement>) => <svg {...base} {...props}><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>;
export const PulseIcon = (props: SVGProps<SVGSVGElement>) => <svg {...base} {...props}><path d="M3 12h4l2.2-6 4.2 12 2.1-6H21"/></svg>;
export const ArrowIcon = (props: SVGProps<SVGSVGElement>) => <svg {...base} {...props}><path d="m9 18 6-6-6-6"/></svg>;
export const ExternalIcon = (props: SVGProps<SVGSVGElement>) => <svg {...base} {...props}><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>;
export const MenuIcon = (props: SVGProps<SVGSVGElement>) => <svg {...base} {...props}><path d="M4 7h16M4 12h16M4 17h16"/></svg>;
export const CloseIcon = (props: SVGProps<SVGSVGElement>) => <svg {...base} {...props}><path d="m6 6 12 12M18 6 6 18"/></svg>;
export const LayersIcon = (props: SVGProps<SVGSVGElement>) => <svg {...base} {...props}><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/></svg>;
export const CheckCircleIcon = (props: SVGProps<SVGSVGElement>) => <svg {...base} {...props}><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 5-5"/></svg>;
export const WarningIcon = (props: SVGProps<SVGSVGElement>) => <svg {...base} {...props}><path d="M12 3.5 21.5 20h-19L12 3.5Z"/><path d="M12 10v4"/><path d="M12 17.2v.1"/></svg>;
export const CompassIcon = (props: SVGProps<SVGSVGElement>) => <svg {...base} {...props}><circle cx="12" cy="12" r="9"/><path d="m15 9-2 6-6 2 2-6 6-2Z"/></svg>;
export const ChevronRightIcon = (props: SVGProps<SVGSVGElement>) => <svg {...base} {...props}><path d="m9 6 6 6-6 6"/></svg>;
export const LockIcon = (props: SVGProps<SVGSVGElement>) => <svg {...base} {...props}><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>;
export const InboxIcon = (props: SVGProps<SVGSVGElement>) => <svg {...base} {...props}><path d="M4 12h4l2 3h4l2-3h4"/><path d="M5.5 5h13L21 12v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6L5.5 5Z"/></svg>;

// Simple abstract glyphs for the Dashboard's integration-chain banner
// (FlowAnimation) — used only for the two integrations that don't have a
// verifiable official mark available (see below); every other chip in
// that banner uses the real, official brand logo.
export const RadarIcon = (props: SVGProps<SVGSVGElement>) => <svg {...base} {...props}><path d="M12 21s7-7.58 7-12A7 7 0 0 0 5 9c0 4.42 7 12 7 12Z"/><circle cx="12" cy="9" r="2.4"/></svg>;
export const TerminalIcon = (props: SVGProps<SVGSVGElement>) => <svg {...base} {...props}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/></svg>;

// Official brand marks (exact path data), used as-is at their real brand
// colors rather than `currentColor` line icons like the rest of this
// file — sourced from the `simple-icons` (CC0) and `devicon` (MIT) open
// icon datasets so they're the actual logos, not approximations:
//   - Convex, ElevenLabs, GitHub, Firebase, WhatsApp: simple-icons
//   - Twilio: devicon (not present in simple-icons)
// Context.dev and Devin have no verified vector mark in either dataset,
// so those two chips still use the generic icons above.
const brandBase = { width: 16, height: 16, viewBox: "0 0 24 24" };
export const ConvexLogo = (props: SVGProps<SVGSVGElement>) => (
  <svg {...brandBase} {...props}>
    <path
      fill="#EE342F"
      d="M15.09 18.916c3.488-.387 6.776-2.246 8.586-5.348-.857 7.673-9.247 12.522-16.095 9.545a3.47 3.47 0 0 1-1.547-1.314c-1.539-2.417-2.044-5.492-1.318-8.282 2.077 3.584 6.3 5.78 10.374 5.399m-10.501-7.65c-1.414 3.266-1.475 7.092.258 10.24-6.1-4.59-6.033-14.41-.074-18.953a3.44 3.44 0 0 1 1.893-.707c2.825-.15 5.695.942 7.708 2.977-4.09.04-8.073 2.66-9.785 6.442m11.757-5.437C14.283 2.951 11.053.992 7.515.933c6.84-3.105 15.253 1.929 16.17 9.37a3.6 3.6 0 0 1-.334 2.02c-1.278 2.594-3.647 4.607-6.416 5.352 2.029-3.763 1.778-8.36-.589-11.847"
    />
  </svg>
);
export const ElevenLabsLogo = (props: SVGProps<SVGSVGElement>) => (
  <svg {...brandBase} {...props}>
    <path fill="#000000" d="M4.6035 0v24h4.9317V0zm9.8613 0v24h4.9317V0z" />
  </svg>
);
export const GitHubLogo = (props: SVGProps<SVGSVGElement>) => (
  <svg {...brandBase} {...props}>
    <path
      fill="#181717"
      d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
    />
  </svg>
);
export const FirebaseLogo = (props: SVGProps<SVGSVGElement>) => (
  <svg {...brandBase} {...props}>
    <path
      fill="#DD2C00"
      d="M19.455 8.369c-.538-.748-1.778-2.285-3.681-4.569-.826-.991-1.535-1.832-1.884-2.245a146 146 0 0 0-.488-.576l-.207-.245-.113-.133-.022-.032-.01-.005L12.57 0l-.609.488c-1.555 1.246-2.828 2.851-3.681 4.64-.523 1.064-.864 2.105-1.043 3.176-.047.241-.088.489-.121.738-.209-.017-.421-.028-.632-.033-.018-.001-.035-.002-.059-.003a7.46 7.46 0 0 0-2.28.274l-.317.089-.163.286c-.765 1.342-1.198 2.869-1.252 4.416-.07 2.01.477 3.954 1.583 5.625 1.082 1.633 2.61 2.882 4.42 3.611l.236.095.071.025.003-.001a9.59 9.59 0 0 0 2.941.568q.171.006.342.006c1.273 0 2.513-.249 3.69-.742l.008.004.313-.145a9.63 9.63 0 0 0 3.927-3.335c1.01-1.49 1.577-3.234 1.641-5.042.075-2.161-.643-4.304-2.133-6.371m-7.083 6.695c.328 1.244.264 2.44-.191 3.558-1.135-1.12-1.967-2.352-2.475-3.665-.543-1.404-.87-2.74-.974-3.975.48.157.922.366 1.315.622 1.132.737 1.914 1.902 2.325 3.461zm.207 6.022c.482.368.99.712 1.513 1.028-.771.21-1.565.302-2.369.273a8 8 0 0 1-.373-.022c.458-.394.869-.823 1.228-1.279zm1.347-6.431c-.516-1.957-1.527-3.437-3.002-4.398-.647-.421-1.385-.741-2.194-.95.011-.134.026-.268.043-.4.014-.113.03-.216.046-.313.133-.689.332-1.37.589-2.025.099-.25.206-.499.321-.74l.004-.008c.177-.358.376-.719.61-1.105l.092-.152-.003-.001c.544-.851 1.197-1.627 1.942-2.311l.288.341c.672.796 1.304 1.548 1.878 2.237 1.291 1.549 2.966 3.583 3.612 4.48 1.277 1.771 1.893 3.579 1.83 5.375-.049 1.395-.461 2.755-1.195 3.933-.694 1.116-1.661 2.05-2.8 2.708-.636-.318-1.559-.839-2.539-1.599.79-1.575.952-3.28.479-5.072zm-2.575 5.397c-.725.939-1.587 1.55-2.09 1.856-.081-.029-.163-.06-.243-.093l-.065-.026c-1.49-.616-2.747-1.656-3.635-3.01-.907-1.384-1.356-2.993-1.298-4.653.041-1.19.338-2.327.882-3.379.316-.07.638-.114.96-.131l.084-.002c.162-.003.324-.003.478 0 .227.011.454.035.677.07.073 1.513.445 3.145 1.105 4.852.637 1.644 1.694 3.162 3.144 4.515z"
    />
  </svg>
);
export const WhatsAppLogo = (props: SVGProps<SVGSVGElement>) => (
  <svg {...brandBase} {...props}>
    <path
      fill="#25D366"
      d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"
    />
  </svg>
);
export const TwilioLogo = (props: SVGProps<SVGSVGElement>) => (
  <svg width={16} height={16} viewBox="0 0 128 128" {...props}>
    <path
      fill="#F22F46"
      d="M48 92.309c16.41 0 16.41-24.618 0-24.618S31.59 92.31 48 92.31Zm0-32c16.41 0 16.41-24.618 0-24.618S31.59 60.31 48 60.31Zm32 32c16.41 0 16.41-24.618 0-24.618S63.59 92.31 80 92.31Zm0-32c16.41 0 16.41-24.618 0-24.618S63.59 60.31 80 60.31ZM64 0c34.664 0 64 29.336 64 64s-29.336 64-64 64S0 98.664 0 64 29.336 0 64 0Zm0 17.23c-25.758 0-46.77 20.286-46.77 45.91 0 25.626 21.012 47.63 46.77 47.63 25.758 0 46.77-22.004 46.77-47.63 0-25.624-21.012-45.91-46.77-45.91Zm0 0"
    />
  </svg>
);
