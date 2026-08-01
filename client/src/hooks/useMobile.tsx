import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const TABLET_BREAKPOINT = 1024;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(
    undefined
  );

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}

/**
 * Doc 10 / U9 — true for the tablet band (768px ≤ width < 1024px). NOTE: the app already
 * keeps the persistent sidebar on tablets (useIsMobile only collapses below 768px), so the
 * audit's "iPad gets mobile nav" concern does not apply at ≥768px. This hook lets a
 * component opt into tablet-aware DENSITY (e.g. fewer grid columns) without changing the
 * mobile/sidebar behaviour.
 */
/**
 * True on devices whose primary pointer is touch (`pointer: coarse`) — phones,
 * tablets, touch laptops — regardless of width. Used to switch the cascading nav
 * from hover semantics (open/close on mouseenter/leave) to tap semantics, enlarge
 * touch targets, and collapse the Level-2/3 cascade into a single inline drill.
 */
export function useIsCoarsePointer() {
  const [coarse, setCoarse] = React.useState<boolean>(false);

  React.useEffect(() => {
    const mql = window.matchMedia("(pointer: coarse)");
    const onChange = () => setCoarse(mql.matches);
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return coarse;
}

export function useIsTablet() {
  const [isTablet, setIsTablet] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const w = window.innerWidth;
    return w >= MOBILE_BREAKPOINT && w < TABLET_BREAKPOINT;
  });

  React.useEffect(() => {
    const mql = window.matchMedia(
      `(min-width: ${MOBILE_BREAKPOINT}px) and (max-width: ${TABLET_BREAKPOINT - 1}px)`,
    );
    const onChange = () => {
      const w = window.innerWidth;
      setIsTablet(w >= MOBILE_BREAKPOINT && w < TABLET_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isTablet;
}
