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
