/**
 * T2a-1 (doc 20 §1/§5) — URDF (Unified Robot Description Format) parser.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A small, PURE, dependency-free parser for the SUBSET of URDF the model pipeline
 * needs to (1) build a renderable glTF and (2) extract a kinematic chain for the T2b
 * simulation gate. It parses:
 *
 *   <robot name>
 *     <link name>
 *       <visual>/<collision>
 *         <origin xyz rpy>
 *         <geometry>
 *           <box size="x y z"> | <cylinder radius length> | <sphere radius>
 *           | <mesh filename scale>
 *     <joint name type>
 *       <parent link> <child link>
 *       <origin xyz rpy>
 *       <axis xyz>
 *       <limit lower upper effort velocity>
 *
 * It then assembles the link/joint tree (each joint edges parent→child) and picks
 * a single ROOT link (the one that is never a child). This mirrors the b2mmlCodec
 * precedent: no XML dep is in the tree, so the XML tokeniser is hand-rolled here
 * (elements + attributes + self-closing tags; no namespaces/DOCTYPE/entities beyond
 * the standard five). SECURITY: DOCTYPE/ENTITY are rejected (no XXE surface).
 *
 * HONESTY: `<mesh filename=...>` refs are parsed and PRESERVED (filename + scale) but
 * external STL/DAE geometry is NOT triangulated here — that is the glTF emitter's call
 * (cheap ASCII-STL only; otherwise a placeholder + a documented seam). Nothing is faked.
 * ════════════════════════════════════════════════════════════════════════════
 */

// ── Parsed geometry / link / joint types ────────────────────────────────────────

/** URDF units are METRES / RADIANS. We keep them; the glTF stays in metres, and the
 *  kinematic-chain extractor converts to the T2b millimetre convention explicitly. */
export type Vec3 = [number, number, number];

export type UrdfGeometry =
  | { kind: "box"; size: Vec3 }
  | { kind: "cylinder"; radius: number; length: number }
  | { kind: "sphere"; radius: number }
  | { kind: "mesh"; filename: string; scale: Vec3 };

export interface UrdfOrigin {
  /** Translation (metres). */
  xyz: Vec3;
  /** Roll-pitch-yaw (radians), applied X→Y→Z (URDF convention). */
  rpy: Vec3;
}

export interface UrdfVisual {
  origin: UrdfOrigin;
  geometry: UrdfGeometry;
}

export interface UrdfLink {
  name: string;
  /** First <visual> (rendered). */
  visual?: UrdfVisual;
  /** First <collision> (used for bounding volume when present, else falls back to visual). */
  collision?: UrdfVisual;
}

export type UrdfJointType = "revolute" | "prismatic" | "fixed" | "continuous";

export interface UrdfJointLimit {
  lower?: number;
  upper?: number;
  effort?: number;
  velocity?: number;
}

export interface UrdfJoint {
  name: string;
  type: UrdfJointType;
  parent: string;
  child: string;
  origin: UrdfOrigin;
  /** Joint axis (unit-ish); default [1,0,0] per URDF spec. */
  axis: Vec3;
  limit?: UrdfJointLimit;
}

export interface UrdfRobot {
  name: string;
  links: UrdfLink[];
  joints: UrdfJoint[];
  /** The single link that is never a child of any joint (the base/root). */
  rootLink: string | null;
  /** child-link → the joint whose `child` is that link (parent lookup). */
  jointByChild: Record<string, UrdfJoint>;
  /** parent-link → joints whose `parent` is that link (tree edges out). */
  jointsByParent: Record<string, UrdfJoint[]>;
}

// ── Minimal XML tokeniser (hand-rolled, mirrors b2mmlCodec.parseXml) ─────────────

interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

function parseXml(xml: string): XmlNode {
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    throw new Error("DOCTYPE/ENTITY not allowed (XXE protection).");
  }
  let s = xml.replace(/<\?[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "").trim();
  let pos = 0;
  const len = s.length;

  function parseNode(): XmlNode | null {
    while (pos < len && /\s/.test(s[pos])) pos++;
    if (pos >= len || s[pos] !== "<") return null;
    if (s[pos + 1] === "/") return null;
    pos++; // '<'
    let tag = "";
    while (pos < len && !/[\s/>]/.test(s[pos])) tag += s[pos++];
    const attrs: Record<string, string> = {};
    while (pos < len && s[pos] !== ">" && s[pos] !== "/") {
      while (pos < len && /\s/.test(s[pos])) pos++;
      if (s[pos] === ">" || s[pos] === "/") break;
      let name = "";
      while (pos < len && !/[\s=/>]/.test(s[pos])) name += s[pos++];
      while (pos < len && /\s/.test(s[pos])) pos++;
      if (s[pos] === "=") {
        pos++;
        while (pos < len && /\s/.test(s[pos])) pos++;
        const quote = s[pos];
        if (quote === '"' || quote === "'") {
          pos++;
          let val = "";
          while (pos < len && s[pos] !== quote) val += s[pos++];
          pos++;
          attrs[name] = unescapeXml(val);
        }
      } else if (name) {
        attrs[name] = "";
      }
    }
    const node: XmlNode = { tag, attrs, children: [], text: "" };
    if (s[pos] === "/") {
      pos++;
      if (s[pos] === ">") pos++;
      return node;
    }
    if (s[pos] === ">") pos++;
    let text = "";
    while (pos < len) {
      if (s[pos] === "<") {
        if (s[pos + 1] === "/") {
          while (pos < len && s[pos] !== ">") pos++;
          pos++;
          break;
        }
        const child = parseNode();
        if (child) node.children.push(child);
        else break;
      } else {
        text += s[pos++];
      }
    }
    node.text = unescapeXml(text.trim());
    return node;
  }

  const root = parseNode();
  if (!root) throw new Error("No root element found in URDF XML.");
  return root;
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

// ── Small helpers ────────────────────────────────────────────────────────────────

function firstChild(node: XmlNode, tag: string): XmlNode | undefined {
  return node.children.find((c) => c.tag === tag);
}
function allChildren(node: XmlNode, tag: string): XmlNode[] {
  return node.children.filter((c) => c.tag === tag);
}

/** Parse a whitespace-separated list of N numbers into a fixed Vec3 (missing → 0). */
function parseVec3(raw: string | undefined, fallback: Vec3 = [0, 0, 0]): Vec3 {
  if (!raw) return [...fallback];
  const parts = raw.trim().split(/\s+/).map(Number);
  return [
    Number.isFinite(parts[0]) ? parts[0] : fallback[0],
    Number.isFinite(parts[1]) ? parts[1] : fallback[1],
    Number.isFinite(parts[2]) ? parts[2] : fallback[2],
  ];
}

function parseNum(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function parseOrigin(node: XmlNode | undefined): UrdfOrigin {
  const o = node ? firstChild(node, "origin") : undefined;
  return {
    xyz: parseVec3(o?.attrs.xyz, [0, 0, 0]),
    rpy: parseVec3(o?.attrs.rpy, [0, 0, 0]),
  };
}

function parseGeometry(container: XmlNode): UrdfGeometry | null {
  const geom = firstChild(container, "geometry");
  if (!geom) return null;
  const box = firstChild(geom, "box");
  if (box) return { kind: "box", size: parseVec3(box.attrs.size, [0.1, 0.1, 0.1]) };
  const cyl = firstChild(geom, "cylinder");
  if (cyl) {
    return {
      kind: "cylinder",
      radius: parseNum(cyl.attrs.radius) ?? 0.05,
      length: parseNum(cyl.attrs.length) ?? 0.1,
    };
  }
  const sph = firstChild(geom, "sphere");
  if (sph) return { kind: "sphere", radius: parseNum(sph.attrs.radius) ?? 0.05 };
  const mesh = firstChild(geom, "mesh");
  if (mesh) {
    return {
      kind: "mesh",
      filename: mesh.attrs.filename ?? "",
      scale: parseVec3(mesh.attrs.scale, [1, 1, 1]),
    };
  }
  return null;
}

function parseVisualLike(node: XmlNode | undefined): UrdfVisual | undefined {
  if (!node) return undefined;
  const geometry = parseGeometry(node);
  if (!geometry) return undefined;
  return { origin: parseOrigin(node), geometry };
}

// ── Main parse ────────────────────────────────────────────────────────────────

/**
 * Parse a URDF XML string into a link/joint tree. PURE + testable. Throws on
 * malformed XML or a missing <robot> root; returns an empty-but-valid robot for a
 * robot with no links/joints (so the caller can decide what to do).
 */
export function parseUrdf(xml: string): UrdfRobot {
  const root = parseXml(xml);
  if (root.tag !== "robot") {
    throw new Error(`Expected <robot> root, got <${root.tag}>.`);
  }

  const links: UrdfLink[] = allChildren(root, "link").map((ln) => ({
    name: ln.attrs.name ?? "",
    visual: parseVisualLike(firstChild(ln, "visual")),
    collision: parseVisualLike(firstChild(ln, "collision")),
  }));

  const joints: UrdfJoint[] = allChildren(root, "joint").map((jn) => {
    const type = (jn.attrs.type as UrdfJointType) ?? "fixed";
    const parent = firstChild(jn, "parent")?.attrs.link ?? "";
    const child = firstChild(jn, "child")?.attrs.link ?? "";
    const axisNode = firstChild(jn, "axis");
    const limitNode = firstChild(jn, "limit");
    let limit: UrdfJointLimit | undefined;
    if (limitNode) {
      limit = {
        lower: parseNum(limitNode.attrs.lower),
        upper: parseNum(limitNode.attrs.upper),
        effort: parseNum(limitNode.attrs.effort),
        velocity: parseNum(limitNode.attrs.velocity),
      };
    }
    return {
      name: jn.attrs.name ?? "",
      type,
      parent,
      child,
      origin: parseOrigin(jn),
      axis: parseVec3(axisNode?.attrs.xyz, [1, 0, 0]),
      limit,
    };
  });

  // Build parent/child indices and find the root (a link that is never a child).
  const jointByChild: Record<string, UrdfJoint> = {};
  const jointsByParent: Record<string, UrdfJoint[]> = {};
  const childLinks = new Set<string>();
  for (const j of joints) {
    if (j.child) {
      jointByChild[j.child] = j;
      childLinks.add(j.child);
    }
    if (j.parent) {
      (jointsByParent[j.parent] ??= []).push(j);
    }
  }
  let rootLink: string | null = null;
  for (const l of links) {
    if (!childLinks.has(l.name)) {
      rootLink = l.name;
      break;
    }
  }

  return { name: root.attrs.name ?? "robot", links, joints, rootLink, jointByChild, jointsByParent };
}

/**
 * Walk the link tree from the root in kinematic order (each yielded link paired with
 * the joint that CARRIES it — null for the root). A depth-first traversal that follows
 * jointsByParent edges. Cycles (malformed URDF) are guarded with a visited set.
 */
export function walkLinkTree(
  robot: UrdfRobot,
): Array<{ link: UrdfLink; joint: UrdfJoint | null; depth: number }> {
  const byName: Record<string, UrdfLink> = {};
  for (const l of robot.links) byName[l.name] = l;
  const out: Array<{ link: UrdfLink; joint: UrdfJoint | null; depth: number }> = [];
  const visited = new Set<string>();

  const visit = (linkName: string, joint: UrdfJoint | null, depth: number) => {
    if (visited.has(linkName)) return;
    visited.add(linkName);
    const link = byName[linkName];
    if (!link) return;
    out.push({ link, joint, depth });
    for (const j of robot.jointsByParent[linkName] ?? []) {
      visit(j.child, j, depth + 1);
    }
  };

  if (robot.rootLink) visit(robot.rootLink, null, 0);
  // Include any orphan links not reachable from the root (malformed / multi-tree URDF).
  for (const l of robot.links) if (!visited.has(l.name)) visit(l.name, robot.jointByChild[l.name] ?? null, 0);
  return out;
}
