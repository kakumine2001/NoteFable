import { describe, expect, it } from "vitest";
import { consumeSseData } from "./sse";

describe("consumeSseData", () => {
  it("分割された data 行を次の呼び出しで完成させる", () => {
    const first = consumeSseData('data: {"delta":"hel');
    const second = consumeSseData(`${first.remainder}lo"}\n`);

    expect(first.data).toEqual([]);
    expect(second).toEqual({
      data: ['{"delta":"hello"}'],
      remainder: "",
    });
  });

  it("flush 時は末尾に改行がない data 行も返す", () => {
    expect(consumeSseData('data: {"delta":"tail"}', true)).toEqual({
      data: ['{"delta":"tail"}'],
      remainder: "",
    });
  });

  it("DONE と空の data 行を無視する", () => {
    expect(consumeSseData("data: [DONE]\ndata:\n", true)).toEqual({
      data: [],
      remainder: "",
    });
  });

  it("data 以外の SSE 行を無視する", () => {
    expect(
      consumeSseData(
        'event: message\nid: 1\n: keep-alive\ndata: {"delta":"ok"}\n',
      ),
    ).toEqual({
      data: ['{"delta":"ok"}'],
      remainder: "",
    });
  });
});
