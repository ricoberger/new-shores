import { describe, expect, it } from "vitest";
import { type ContainerLike, type RegistrationLike, SKIP_WAITING, UpdateFlow, type WorkerLike } from "./update";

class FakeWorker implements WorkerLike {
  state = "installing";
  messages: unknown[] = [];
  private readonly ls: (() => void)[] = [];
  postMessage(m: unknown) {
    this.messages.push(m);
  }
  addEventListener(_t: "statechange", l: () => void) {
    this.ls.push(l);
  }
  set(state: string) {
    this.state = state;
    for (const l of this.ls) l();
  }
}

class FakeRegistration implements RegistrationLike {
  active: WorkerLike | null = null;
  waiting: WorkerLike | null = null;
  installing: WorkerLike | null = null;
  private readonly ls: (() => void)[] = [];
  addEventListener(_t: "updatefound", l: () => void) {
    this.ls.push(l);
  }
  found(w: FakeWorker) {
    this.installing = w;
    for (const l of this.ls) l();
  }
}

class FakeContainer implements ContainerLike {
  controller: unknown = null;
  private readonly ls: (() => void)[] = [];
  addEventListener(_t: "controllerchange", l: () => void) {
    this.ls.push(l);
  }
  change() {
    for (const l of this.ls) l();
  }
}

function setup(controlled: boolean) {
  const container = new FakeContainer();
  container.controller = controlled ? {} : null;
  let reloads = 0;
  const flow = new UpdateFlow(container, () => reloads++);
  let notified = 0;
  flow.subscribe(() => notified++);
  const reg = new FakeRegistration();
  if (controlled) reg.active = new FakeWorker();
  return { container, flow, reg, reloads: () => reloads, notified: () => notified };
}

describe("UpdateFlow", () => {
  it("offers an installed worker as an update while an old one controls the page", () => {
    const t = setup(true);
    t.flow.watch(t.reg);
    expect(t.flow.available()).toBe(false);
    const w = new FakeWorker();
    t.reg.found(w);
    expect(t.flow.available()).toBe(false);
    w.set("installed");
    expect(t.flow.available()).toBe(true);
    expect(t.notified()).toBe(1);
  });

  it("does not treat the first install (no controller) as an update", () => {
    const t = setup(false);
    t.flow.watch(t.reg);
    const w = new FakeWorker();
    t.reg.found(w);
    w.set("installed");
    expect(t.flow.available()).toBe(false);
  });

  it("never offers the first worker of a registration, even if it reports installed after taking control", () => {
    // WebKit: the page is controlled (clients.claim) before the first
    // worker's "installed" state change is delivered.
    const t = setup(false);
    t.flow.watch(t.reg);
    const w = new FakeWorker();
    t.reg.found(w);
    t.container.controller = {};
    w.set("installed");
    expect(t.flow.available()).toBe(false);
    // The first worker was already installing when the page started watching.
    const u = setup(false);
    const first = new FakeWorker();
    u.reg.installing = first;
    u.flow.watch(u.reg);
    u.reg.found(first);
    u.container.controller = {};
    first.set("installed");
    expect(u.flow.available()).toBe(false);
    // A later worker is an update.
    const next = new FakeWorker();
    u.reg.found(next);
    next.set("installed");
    expect(u.flow.available()).toBe(true);
  });

  it("offers an update that was already installing when watching started", () => {
    const t = setup(true);
    const w = new FakeWorker();
    t.reg.installing = w;
    t.flow.watch(t.reg);
    // A late updatefound for the same worker must not observe it twice.
    t.reg.found(w);
    expect(t.flow.available()).toBe(false);
    w.set("installed");
    expect(t.flow.available()).toBe(true);
    expect(t.notified()).toBe(1);
  });

  it("offers a worker that was already waiting at registration", () => {
    const t = setup(true);
    t.reg.waiting = new FakeWorker();
    t.flow.watch(t.reg);
    expect(t.flow.available()).toBe(true);
  });

  it("apply asks the waiting worker to skip waiting and reloads once on controllerchange", () => {
    const t = setup(true);
    const w = new FakeWorker();
    t.reg.waiting = w;
    t.flow.watch(t.reg);
    t.flow.apply();
    expect(w.messages).toEqual([SKIP_WAITING]);
    expect(t.reloads()).toBe(0);
    t.container.change();
    t.container.change();
    expect(t.reloads()).toBe(1);
  });

  it("apply without an update does nothing", () => {
    const t = setup(true);
    t.flow.watch(t.reg);
    t.flow.apply();
    t.container.change();
    expect(t.reloads()).toBe(0);
  });
});
