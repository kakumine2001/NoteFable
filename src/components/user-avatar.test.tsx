import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ failed: null as Set<string> | null }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: () => Set<string>) => {
    state.failed ??= initial();
    return [state.failed, (update: (current: Set<string>) => Set<string>) => {
      state.failed = update(state.failed!);
    }];
  },
}));
import { UserAvatar } from "./user-avatar";

const user = { avatarUrl: "/api/account/avatar?v=one", image: "https://example.com/google.png", icon: null, name: "Kaku" };
type Image = ReactElement<{ src: string; onError: () => void }>;
const child = (profile = user) => UserAvatar({ user: profile }).props.children as Image | string;

describe("avatar image failure fallback", () => {
  beforeEach(() => { state.failed = null; });

  it("falls back to the initial after both photo sources fail without retrying either", () => {
    const uploaded = child() as Image;
    expect(uploaded.props.src).toBe(user.avatarUrl);
    uploaded.props.onError();
    const google = child() as Image;
    expect(google.props.src).toBe(user.image);
    google.props.onError();
    expect(child()).toBe("K");
    expect(child()).toBe("K");
  });

  it("tries a newly uploaded version even if previous photos failed", () => {
    (child() as Image).props.onError();
    (child() as Image).props.onError();
    expect((child({ ...user, avatarUrl: "/api/account/avatar?v=two" }) as Image).props.src).toBe("/api/account/avatar?v=two");
  });
});
