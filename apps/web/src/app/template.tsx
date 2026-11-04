/// Every navigation remounts this wrapper, which plays a short fade and rise (UI_CONTRACT.md Section 8:
/// in-app transitions stay at or under 200 ms). It fills the scroll area so a page that sizes itself to
/// its parent (the terminals, the landing page) still can. Reduced motion collapses the animation.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="route-in h-full">{children}</div>;
}
