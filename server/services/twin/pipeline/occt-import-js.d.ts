/**
 * T4 (doc 24 Wave-3) — ambient types for `occt-import-js` (OpenCASCADE WASM).
 *
 * The published package ships NO .d.ts (main = dist/occt-import-js.js, an Emscripten
 * factory). Without this declaration `tsc --noEmit` fails with TS7016 on the lazy
 * `import("occt-import-js")` in stepToGltf.ts. We type ONLY the surface we use:
 * the factory + `ReadStepFile/ReadIgesFile` and their JSON result shape (verified
 * against the real wasm output — see stepConversion.t4.test.ts).
 */
declare module "occt-import-js" {
  /** A flat typed-array wrapper as occt returns it (`{ array: [...] }`). */
  export interface OcctFloatArray {
    array: number[];
  }
  export interface OcctIndexArray {
    array: number[];
  }
  export interface OcctMeshAttributes {
    position: OcctFloatArray;
    /** Present by default; may be absent if occt could not compute per-vertex normals. */
    normal?: OcctFloatArray;
  }
  export interface OcctBrepFace {
    first: number;
    last: number;
    color?: [number, number, number] | null;
  }
  /** One triangulated solid/shell. Positions are in the STEP file's own units (usually mm). */
  export interface OcctMesh {
    name: string;
    color?: [number, number, number] | null;
    attributes: OcctMeshAttributes;
    index: OcctIndexArray;
    brep_faces?: OcctBrepFace[];
  }
  export interface OcctNode {
    name: string;
    meshes: number[];
    children: OcctNode[];
  }
  export interface OcctReadResult {
    success: boolean;
    root: OcctNode;
    meshes: OcctMesh[];
  }
  export interface OcctReadParams {
    linearUnit?: "millimeter" | "centimeter" | "meter" | "inch" | "foot";
    linearDeflection?: number;
    angularDeflection?: number;
  }
  export interface OcctModule {
    ReadStepFile(content: Uint8Array, params?: OcctReadParams | null): OcctReadResult;
    ReadIgesFile(content: Uint8Array, params?: OcctReadParams | null): OcctReadResult;
    ReadBrepFile(content: Uint8Array, params?: OcctReadParams | null): OcctReadResult;
  }
  export interface OcctFactoryArg {
    locateFile?: (pathName: string, scriptDirectory: string) => string;
    print?: (line: string) => void;
    printErr?: (line: string) => void;
  }
  /** The Emscripten factory (module.exports). Resolves once the WASM has initialised. */
  const occtimportjs: (arg?: OcctFactoryArg) => Promise<OcctModule>;
  export default occtimportjs;
}
