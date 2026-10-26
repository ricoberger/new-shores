import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Scene } from "@babylonjs/core/scene";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { ContentBuilding } from "../api/client";
import { FIELDS } from "../theme/palette";
import { footprintBox } from "./coords";
import { frontOffset, mergeItems, riseScale } from "./buildings";
import {
  anchorOffset,
  atDetail,
  DEFAULT_STATUS_Y,
  entryFiles,
  footprintScale,
  type ModelData,
  type ModelEntry,
  type ModelFile,
  type ModelManifest,
  ModelRegistry,
  modelFileFor,
  modelUrl,
  parseGlb,
  placement,
  rotationYaw,
  stableHash,
  statusHeight,
  toWorld,
  variantIndex,
  worldData,
} from "./models";

const MODELS = join(__dirname, "..", "..", "public", "models");
const REPO = join(__dirname, "..", "..", "..");
const manifest = JSON.parse(readFileSync(join(MODELS, "manifest.json"), "utf8")) as ModelManifest;

const engine = new NullEngine();
const scene = new Scene(engine);
afterAll(() => engine.dispose());

function file(path: string, extra: Partial<ModelFile> = {}): ModelFile {
  return { path, triangles: 1, bytes: 1, sha256: "0123456789abcdef".repeat(4), bounds: { min: [0, 0, 0], max: [1, 1, 1] }, ...extra };
}

function def(id: string, width: number, height: number): ContentBuilding {
  return { id, width, height, category: "production" } as unknown as ContentBuilding;
}

describe("committed models are consistent with the manifest (Blender-free)", () => {
  const all = Object.entries(manifest.models).flatMap(([id, e]) => entryFiles(e).map((f) => [id, f] as const));

  it("every manifest file exists with its sha256, size and triangle count, within its budget", () => {
    expect(all.length).toBeGreaterThan(30);
    for (const [, f] of all) {
      const data = readFileSync(join(MODELS, f.path));
      expect(createHash("sha256").update(data).digest("hex"), f.path).toBe(f.sha256);
      expect(data.length, f.path).toBe(f.bytes);
      const doc = glbJson(data);
      const prim = doc.meshes[0]!.primitives[0]!;
      expect(doc.accessors[prim.indices]!.count / 3, f.path).toBe(f.triangles);
      expect(f.triangles, f.path).toBeLessThanOrEqual(f.budget ?? Infinity);
    }
  });

  it("every GLB meets the export profile (one mesh and primitive, POSITION/NORMAL/COLOR_0, no textures, animations or extensions)", () => {
    for (const [, f] of all) {
      const doc = glbJson(readFileSync(join(MODELS, f.path)));
      expect(doc.meshes.length, f.path).toBe(1);
      expect(doc.meshes[0]!.primitives.length, f.path).toBe(1);
      const prim = doc.meshes[0]!.primitives[0]!;
      expect(Object.keys(prim.attributes).sort(), f.path).toEqual(["COLOR_0", "NORMAL", "POSITION"]);
      expect(prim.mode ?? 4).toBe(4);
      expect([5123, 5125]).toContain(doc.accessors[prim.indices]!.componentType);
      expect(doc.materials.length).toBe(1);
      for (const k of ["textures", "images", "samplers", "animations", "skins", "extensionsUsed", "extensionsRequired"]) expect(doc[k], `${f.path} ${k}`).toBeUndefined();
      for (const n of doc.nodes) expect(n.matrix ?? n.translation ?? n.rotation ?? n.scale, f.path).toBeUndefined();
    }
  });

  it("the palette hash matches assets/palette.json and every tier 1–2 building, field and the sloop has a model", () => {
    const palette = readFileSync(join(REPO, "assets", "palette.json"));
    expect(manifest.palette_sha256).toBe(createHash("sha256").update(palette).digest("hex"));
    expect(manifest.missing_recipes).toEqual([]);
    const buildings = JSON.parse(readFileSync(join(REPO, "content", "old_coast", "buildings.json"), "utf8")) as { id: string; tier: string; road?: unknown }[];
    const want = buildings.filter((b) => (b.tier === "settlers" || b.tier === "citizens") && !b.road).map((b) => b.id);
    for (const id of [...want, "sloop"]) expect(manifest.models[id], id).toBeDefined();
    expect(manifest.models.house_settlers?.variants).toHaveLength(3);
    expect(manifest.models.house_citizens?.variants).toHaveLength(3);
    expect(Object.keys(manifest.models.warehouse?.levels ?? {})).toEqual(["1", "2", "3"]);
    expect(Object.keys(manifest.models.trading_post?.levels ?? {})).toEqual(["1", "2", "3", "4"]);
    expect(manifest.models.sloop?.attachments?.cargo).toBeDefined();
  });
});

interface GlbDoc {
  meshes: { primitives: { attributes: Record<string, number>; indices: number; mode?: number }[] }[];
  accessors: { count: number; componentType: number }[];
  materials: unknown[];
  nodes: Record<string, unknown>[];
  [k: string]: unknown;
}

function glbJson(data: Buffer): GlbDoc {
  const len = data.readUInt32LE(12);
  return JSON.parse(data.subarray(20, 20 + len).toString("utf8")) as GlbDoc;
}

describe("loading through the registry", () => {
  const ok = (body: Uint8Array | string) => Promise.resolve(new Response(body as BodyInit, { status: 200 }));

  it("loads a committed GLB with the glTF loader into one mesh of vertex data with the manifest's triangle count and palette colours", async () => {
    const entry = manifest.models.wheat_field as ModelEntry;
    const f = entry.file as ModelFile;
    const data = await parseGlb(new Uint8Array(readFileSync(join(MODELS, f.path))), scene);
    expect(data.indices.length / 3).toBe(f.triangles);
    expect(data.colors.length).toBe((data.positions.length / 3) * 4);
    // Some vertex carries the palette's fields.wheat darkened by the baked occlusion (a similar scale on every channel).
    const c = Color3.FromHexString(FIELDS.wheat);
    const rgb = [c.r, c.g, c.b] as const;
    let found = false;
    for (let i = 0; i < data.colors.length; i += 4) {
      const k = [0, 1, 2].map((j) => (data.colors[i + j] as number) / (rgb[j] as number));
      if (Math.min(...k) > 0.6 && Math.max(...k) <= 1.001 && Math.max(...k) - Math.min(...k) < 0.08) found = true;
    }
    expect(found).toBe(true);
    // The loader's PBR material and nodes stay out of the scene (the layers use their own material).
    expect(scene.materials.filter((m) => m.getClassName() === "PBRMaterial")).toHaveLength(0);
    expect(scene.meshes).toHaveLength(0);
  });

  it("fetches the manifest once without cache and each model file once, cache-busted by its hash", async () => {
    const urls: string[] = [];
    const fetchFn = vi.fn((url: string, init?: RequestInit) => {
      urls.push(`${url}${init?.cache ? ` (${init.cache})` : ""}`);
      if (url.endsWith("manifest.json")) return ok(JSON.stringify(manifest));
      const path = url.replace("/models/", "").split("?")[0] as string;
      return ok(new Uint8Array(readFileSync(join(MODELS, path))));
    });
    const reg = new ModelRegistry(scene, { fetch: fetchFn, now: () => 1234 });
    let changes = 0;
    reg.onChange(() => changes++);
    await reg.loadManifest();
    await reg.loadManifest();
    const f = reg.entry("wheat_field")?.file as ModelFile;
    expect(reg.request(f)).toBeNull();
    expect(reg.request(f)).toBeNull();
    expect(reg.status().pending).toEqual(["wheat_field.glb"]);
    await vi.waitFor(() => expect(reg.status().loaded).toEqual(["wheat_field.glb"]));
    expect(reg.request(f)?.indices.length).toBe(f.triangles * 3);
    expect(urls).toEqual(["/models/manifest.json (no-cache)", `/models/wheat_field.glb?v=${f.sha256.slice(0, 8)}`]);
    // firstModelMs is the first rendered frame with a model, not the load.
    expect(reg.status()).toMatchObject({ manifest: true, pending: [], failed: [], bytes: f.bytes, firstModelMs: null });
    expect(reg.rendered()).toBe(false);
    reg.markRendered();
    reg.markRendered();
    expect(reg.status().firstModelMs).toBe(1234);
    expect(changes).toBe(2);
  });

  it("falls back to the placeholder on a 404 or a parse error, warning once per content ID", async () => {
    const warn = vi.fn();
    const fetchFn = (url: string) => (url.includes("v1") ? Promise.resolve(new Response("", { status: 404 })) : ok(new Uint8Array([1, 2, 3])));
    const reg = new ModelRegistry(scene, { fetch: fetchFn, warn });
    const a = file("house_settlers.v1.glb", { sha256: "v1".padEnd(64, "0") });
    const b = file("house_settlers.v2.glb");
    reg.request(a);
    reg.request(b);
    await vi.waitFor(() => expect(reg.status().failed).toEqual(["house_settlers.v1.glb", "house_settlers.v2.glb"]));
    expect(reg.request(a)).toBeNull();
    expect(reg.failed(a)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("house_settlers keeps its placeholder");
  });

  it("keeps placeholders when the manifest is unavailable", async () => {
    const warn = vi.fn();
    const reg = new ModelRegistry(scene, { fetch: () => Promise.reject(new Error("offline")), warn });
    await reg.loadManifest();
    expect(reg.entry("chapel")).toBeUndefined();
    expect(reg.status().manifest).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("builds URLs with the first 8 hex digits of the sha256", () => {
    expect(modelUrl("/models/", file("mill.glb", { sha256: "abcdef0123456789".repeat(4) }))).toBe("/models/mill.glb?v=abcdef01");
  });
});

describe("variants and levels", () => {
  it("are stable per building ID and spread uniformly over the variants", () => {
    expect(variantIndex(42, 3)).toBe(variantIndex(42, 3));
    expect(stableHash(7)).toBe(stableHash("7"));
    const counts = [0, 0, 0];
    for (let id = 1; id <= 1000; id++) counts[variantIndex(id, 3)]! += 1;
    for (const c of counts) expect(c).toBeGreaterThan(280);
    expect(variantIndex(5, 0)).toBe(0);
  });

  it("pick the warehouse level from the payload, the highest available above it", () => {
    const e = { kind: "building", levels: { "1": file("w.l1.glb"), "2": file("w.l2.glb") } } as unknown as ModelEntry;
    expect(modelFileFor(e, { id: 1 })?.path).toBe("w.l1.glb");
    expect(modelFileFor(e, { id: 1, level: 1 })?.path).toBe("w.l1.glb");
    expect(modelFileFor(e, { id: 1, level: 2 })?.path).toBe("w.l2.glb");
    expect(modelFileFor(e, { id: 1, level: 7 })?.path).toBe("w.l2.glb");
    const v = { kind: "building", variants: [file("h.v0.glb"), file("h.v1.glb"), file("h.v2.glb")] } as unknown as ModelEntry;
    expect(modelFileFor(v, { id: 99 })?.path).toBe(`h.v${variantIndex(99, 3)}.glb`);
  });

  it("draw the lite file at the default zoom when there is one", () => {
    const f = file("a.glb", { lite: file("a.lite.glb") });
    expect(atDetail(f, "lite").path).toBe("a.lite.glb");
    expect(atDetail(f, "full").path).toBe("a.glb");
    expect(atDetail(file("b.glb"), "lite").path).toBe("b.glb");
  });
});

describe("orientation and anchors", () => {
  const house = manifest.models.house_settlers as ModelEntry;
  const warehouse = manifest.models.trading_post as ModelEntry;

  it("puts the model front (door anchor) on frontOffset's edge at all four rotations", () => {
    for (const [entry, d] of [
      [house, def("house_settlers", 3, 3)],
      [warehouse, def("trading_post", 6, 9)],
    ] as const) {
      for (const rotation of [0, 90, 180, 270] as const) {
        const box = footprintBox(10, 20, d.width, d.height, rotation);
        const door = anchorOffset(entry, "door", rotation)!;
        const [fx, fz] = frontOffset(rotation);
        const half = fx !== 0 ? box.w / 2 : box.h / 2;
        expect(door[0], `${d.id} ${rotation}`).toBeCloseTo(fx * half, 6);
        expect(door[2], `${d.id} ${rotation}`).toBeCloseTo(fz * half, 6);
      }
    }
  });

  it("rotates and places the model bounds like the footprint", () => {
    const d = def("trading_post", 4, 4);
    for (const rotation of [0, 90, 180, 270] as const) {
      const p = placement(warehouse, d, { x: 3, y: 4, rotation });
      const box = footprintBox(3, 4, 4, 4, rotation);
      expect(p.cx).toBe(box.cx);
      expect(p.cz).toBe(box.cz);
      expect(p.yaw).toBeCloseTo(rotationYaw(rotation));
      // The model fills the footprint within ±0.3 tiles.
      expect(Math.abs(p.rect.w - box.w)).toBeLessThanOrEqual(0.6 + 1e-6);
      expect(Math.abs(p.rect.h - box.h)).toBeLessThanOrEqual(0.6 + 1e-6);
      expect(p.height).toBeGreaterThan(0.5);
    }
  });

  it("stretches a model only when the content footprint differs from the manifest", () => {
    expect(footprintScale(house, def("house_settlers", 3, 3))).toEqual({ sx: 1, sz: 1 });
    expect(footprintScale(house, def("house_settlers", 4.5, 3))).toEqual({ sx: 1.5, sz: 1 });
  });

  it("maps glTF to world coordinates without mirroring (buildings −x, ships −z)", () => {
    expect(toWorld("building", [1, 2, 3])).toEqual([-1, 2, 3]);
    expect(toWorld("ship", [1, 2, 3])).toEqual([1, 2, -3]);
    const data: ModelData = { positions: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), colors: new Float32Array(12).fill(1), indices: new Uint32Array([0, 1, 2]) };
    const ship = worldData("ship", data, 0.5);
    expect([...ship.positions].map((v) => v + 0)).toEqual([0.5, 0, 0, 0, 0.5, 0, 0, 0, -0.5]);
    expect([...ship.normals.slice(0, 3)].map((v) => v + 0)).toEqual([0, 0, -1]);
    expect([...ship.indices]).toEqual([0, 1, 2]);
  });

  it("puts status icons at the manifest anchor, the default without a model", () => {
    expect(statusHeight(house)).toBe(house.anchors.status[1]);
    expect(statusHeight(undefined)).toBe(DEFAULT_STATUS_Y);
    expect(anchorOffset(house, "smoke", 0)).toBeNull();
    const smelter = manifest.models.smelter as ModelEntry;
    expect(anchorOffset(smelter, "smoke", 0)?.[1]).toBeGreaterThan(1.5);
  });
});

describe("merged chunks and the rise-in", () => {
  it("merges instances rotated, moved and tinted into one buffer", () => {
    const data: ModelData = { positions: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, -1]), normals: new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]), colors: new Float32Array(12).fill(1), indices: new Uint32Array([0, 1, 2]) };
    const vd = mergeItems([
      { data, cx: 0, cz: 0, yaw: 0, sx: 1, sz: 1, tint: [1, 1, 1, 1] },
      { data, cx: 10, cz: -5, yaw: Math.PI / 2, sx: 1, sz: 1, tint: [0.5, 0.5, 0.5, 1] },
    ]);
    expect(vd.indices).toEqual(new Uint32Array([0, 1, 2, 3, 4, 5]));
    const p = vd.positions as Float32Array;
    // (1, 0, 0) turned by RotationY(90°) → (0, 0, −1), moved to (10, −5).
    expect(p[9]).toBeCloseTo(10);
    expect(p[11]).toBeCloseTo(-6);
    // (0, 0, −1) → (−1, 0, 0).
    expect(p[15]).toBeCloseTo(9);
    expect((vd.colors as Float32Array)[12]).toBeCloseTo(0.5);
    expect((vd.normals as Float32Array)[11]).toBeCloseTo(-1);
  });

  it("rises from 0 to 1", () => {
    expect(riseScale(0)).toBe(0);
    expect(riseScale(1)).toBe(1);
    expect(riseScale(0.5)).toBeGreaterThan(0.5);
    expect(riseScale(2)).toBe(1);
  });
});
