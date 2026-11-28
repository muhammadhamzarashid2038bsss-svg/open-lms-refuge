"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { RoleName } from "@/lib/auth/permissions";
import { currentDestinationId, linkKind, navigationFor, visibleHref, type NavDestination } from "@/lib/navigation";

const focusClass =
  "focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-zinc-950";

function itemClass(current: boolean, block: boolean): string {
  const tone = current ? "bg-zinc-950 text-white" : "bg-white text-zinc-950";
  const shape = block ? "flex w-full" : "inline-flex";
  return `${shape} min-h-12 items-center rounded-lg border-2 border-zinc-950 px-3 text-base font-medium ${tone} ${focusClass}`;
}

function measureMenu(button: HTMLButtonElement) {
  const rect = button.getBoundingClientRect();
  const alignEnd = rect.left + rect.width / 2 > window.innerWidth / 2;
  const top = Math.round(rect.bottom + 8);
  return {
    top,
    left: alignEnd ? ("auto" as const) : Math.round(rect.left),
    right: alignEnd ? Math.round(window.innerWidth - rect.right) : ("auto" as const),
    maxHeight: Math.max(160, Math.round(window.innerHeight - top - 8)),
  };
}

function scrollToHash(hash: string) {
  if (!hash || hash === "#") {
    window.scrollTo(0, 0);
    return true;
  }
  const target = document.getElementById(decodeURIComponent(hash.slice(1)));
  if (!target) return false;
  target.scrollIntoView({ block: "start" });
  return true;
}

// Scrolling happens as soon as the requested section exists. This only stops
// the search when that section is not on the destination page. A shared phone
// must not keep watching the document for the rest of the visit.
export const HASH_SECTION_WAIT_MS = 8000;

function NavAnchor({
  item,
  current,
  block,
  onActivate,
  onHash,
}: {
  item: NavDestination;
  current: boolean;
  block: boolean;
  onActivate: () => void;
  onHash: (hash: string) => void;
}) {
  const pathname = usePathname() ?? "/";
  const shown = visibleHref(item.href, pathname);
  const kind = linkKind(item.href, pathname);
  const className = itemClass(current, block);
  const label = (
    <>
      {item.label}
      {current ? <span className="sr-only">, current page</span> : null}
    </>
  );
  if (kind === "hash") {
    return (
      <a
        className={className}
        href={shown}
        aria-current={current ? "page" : undefined}
        onClick={(event) => {
          // Do the scroll ourselves. Closing the menu on this tap removes the
          // link, and the browser then drops the jump to the section.
          event.preventDefault();
          onActivate();
          const nextUrl = `${window.location.pathname}${window.location.search}${shown}`;
          if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== nextUrl) {
            window.history.pushState(null, "", nextUrl);
          }
          scrollToHash(shown);
          onHash(shown);
        }}
      >
        {label}
      </a>
    );
  }
  if (kind === "same") {
    return (
      <a
        className={className}
        href={shown}
        aria-current={current ? "page" : undefined}
        onClick={(event) => {
          // A full navigation back to this same page reloads it and flashes
          // "Loading your page…". Clear the section hash and return to the top.
          event.preventDefault();
          onActivate();
          if (window.location.hash) window.history.pushState(null, "", shown);
          onHash("");
          window.scrollTo(0, 0);
        }}
      >
        {label}
      </a>
    );
  }
  return (
    <Link
      className={className}
      href={shown}
      scroll={!shown.includes("#")}
      aria-current={current ? "page" : undefined}
      onClick={onActivate}
    >
      {label}
    </Link>
  );
}

function DestinationMenu({
  label,
  menu,
  wide,
  wideScreen,
  currentId,
  pathname,
  hash,
  onHash,
}: {
  label: string;
  menu: NavDestination[];
  wide: NavDestination[];
  wideScreen: boolean;
  currentId: string;
  pathname: string;
  hash: string;
  onHash: (hash: string) => void;
}) {
  const here = `${pathname}${hash}`;
  const [openKey, setOpenKey] = useState<string | null>(null);
  const open = openKey === here;
  const [box, setBox] = useState<{ top: number; left: number | "auto"; right: number | "auto"; maxHeight: number } | null>(
    null,
  );
  const rootRef = useRef<HTMLLIElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const menuId = useId();
  const inMenu = menu.some((item) => item.id === currentId) || (!wideScreen && wide.some((item) => item.id === currentId));
  const buttonCurrent = inMenu && !open;
  const close = () => setOpenKey(null);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const button = buttonRef.current;
      if (!button) return;
      setBox(measureMenu(button));
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      close();
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const menuList =
    open && box && typeof document !== "undefined" ? (
      <ul
        ref={menuRef}
        id={menuId}
        className="z-40 flex min-w-48 max-w-[calc(100vw-1rem)] flex-col gap-2 overflow-y-auto rounded-lg border-2 border-zinc-950 bg-white p-2"
        style={{ position: "fixed", top: box.top, left: box.left, right: box.right, maxHeight: box.maxHeight }}
      >
        {wide.map((item) => (
          <li key={`menu-${item.id}`} className="md:hidden">
            <NavAnchor
              item={item}
              current={item.id === currentId && !wideScreen}
              block
              onActivate={close}
              onHash={onHash}
            />
          </li>
        ))}
        {menu.map((item) => (
          <li key={item.id}>
            <NavAnchor
              item={item}
              current={item.id === currentId}
              block
              onActivate={close}
              onHash={onHash}
            />
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <li ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        className={itemClass(buttonCurrent, false)}
        aria-expanded={open}
        aria-controls={menuId}
        aria-current={buttonCurrent ? "page" : undefined}
        onClick={() => {
          if (open) {
            close();
            return;
          }
          if (buttonRef.current) setBox(measureMenu(buttonRef.current));
          setOpenKey(here);
        }}
      >
        {label}
        {buttonCurrent ? <span className="sr-only">, current page</span> : null}
      </button>
      {menuList}
    </li>
  );
}

export function RoleNav({ role }: { role: RoleName }) {
  const pathname = usePathname() ?? "/";
  const [hash, setHash] = useState("");
  const [wideScreen, setWideScreen] = useState(false);

  useEffect(() => {
    const read = () => setHash(window.location.hash);
    const onPop = () => {
      const next = window.location.hash;
      setHash(next);
      if (next) scrollToHash(next);
    };
    read();
    window.addEventListener("hashchange", read);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("hashchange", read);
      window.removeEventListener("popstate", onPop);
    };
  }, [pathname]);

  useEffect(() => {
    const next = window.location.hash;
    if (!next || next === "#") return;
    let stopped = false;
    // The previous page can still contain main-content while the next page
    // arrives. That element is not the section the teacher asked for.
    const arrived = () => {
      if (stopped) return true;
      return scrollToHash(next);
    };
    if (arrived()) return;
    const observer = new MutationObserver(() => {
      if (arrived()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const giveUp = window.setTimeout(() => {
      observer.disconnect();
    }, HASH_SECTION_WAIT_MS);
    return () => {
      stopped = true;
      observer.disconnect();
      window.clearTimeout(giveUp);
    };
  }, [pathname]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(min-width: 768px)");
    const apply = () => setWideScreen(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  const nav = navigationFor(role);
  const currentId = currentDestinationId(role, pathname, hash);
  const bar = nav.items.filter((item) => item.placement === "always");
  const wide = nav.items.filter((item) => item.placement === "wide");
  const menu = nav.items.filter((item) => item.placement === "menu");
  const showMenu = nav.menuLabel !== null && (menu.length > 0 || wide.length > 0);

  return (
    <nav aria-label="Main">
      <ul className="flex flex-wrap items-start gap-2">
        {bar.map((item) => (
          <li key={item.id}>
            <NavAnchor item={item} current={item.id === currentId} block={false} onActivate={() => undefined} onHash={setHash} />
          </li>
        ))}
        {wide.map((item) => (
          <li key={item.id} className="hidden md:block">
            <NavAnchor
              item={item}
              current={item.id === currentId && wideScreen}
              block={false}
              onActivate={() => undefined}
              onHash={setHash}
            />
          </li>
        ))}
        {showMenu && nav.menuLabel ? (
          <DestinationMenu
            label={nav.menuLabel}
            menu={menu}
            wide={wide}
            wideScreen={wideScreen}
            currentId={currentId}
            pathname={pathname}
            hash={hash}
            onHash={setHash}
          />
        ) : null}
      </ul>
    </nav>
  );
}
