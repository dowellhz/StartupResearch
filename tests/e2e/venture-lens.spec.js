import { test, expect } from "@playwright/test";

test("real browser completes a review and persists an interrupted SSE follow-up draft", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#emptyHeading")).toContainText(/business plan|商业计划书/i);
  await page.locator("#fileInput").setInputFiles({ name: "e2e-bp.txt", mimeType: "text/plain", buffer: Buffer.from("E2E科技 商业计划书 产品、团队与客户验证材料。".repeat(20)) });
  await page.locator("#companyInput").fill("E2E科技");
  await page.locator("#promptInput").fill("完成端到端核查");
  const created = page.waitForResponse((response) => response.url().endsWith("/api/reviews") && response.request().method() === "POST");
  await page.locator("#sendButton").click();
  const payload = await (await created).json();
  const id = payload.review.id;
  await expect(page.locator("#reportMessage .report-footer")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#reportMessage .report-content")).toContainText("核查结论摘要");

  await page.evaluate(async (reviewId) => {
    const controller = new AbortController();
    const response = await fetch(`/api/reviews/${reviewId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "请给出一个会被中断的追问回答" }),
      signal: controller.signal
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let received = "";
    while (!received.includes("部分回答已生成")) {
      const { done, value } = await reader.read();
      if (done) break;
      received += decoder.decode(value, { stream: true });
    }
    await reader.cancel();
  }, id);
  await expect.poll(async () => {
    const response = await page.request.get(`/api/reviews/${id}`);
    const review = (await response.json()).review;
    return review.messages?.some((message) => message.role === "assistant" && message.status === "incomplete");
  }, { timeout: 10_000 }).toBe(true);
  await page.reload();
  await page.locator(`[data-review-id="${id}"]`).click();
  await expect(page.locator(".message.assistant.incomplete")).toContainText("上次回答未完成");
});

test("browser-originated parallel submissions enforce the owner task ceiling", async ({ page }) => {
  await page.goto("/");
  const submissions = await page.evaluate(async () => {
    const contents = "E2E parallel company business plan product team market customer evidence. ".repeat(30);
    const data = btoa(contents);
    return Promise.all(Array.from({ length: 4 }, async (_, index) => {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName: `并行公司${index}`, instruction: `并行核查${index}`, file: { filename: `${index}.txt`, mimeType: "text/plain", size: contents.length, data } })
      });
      const payload = await response.json();
      return { status: response.status, id: payload.review?.id, error: payload.error };
    }));
  });
  const statuses = submissions.map((item) => item.status);
  expect(statuses.filter((status) => status === 202)).toHaveLength(3);
  expect(statuses).toContain(429);
  await expect.poll(async () => {
    const response = await page.request.get("/api/reviews");
    const reviews = (await response.json()).reviews || [];
    return reviews.filter((review) => submissions.some((item) => item.id === review.id) && review.reportAvailable).length;
  }, { timeout: 30_000 }).toBe(3);
});

test("real browser rejects an oversized upload before network submission", async ({ page }) => {
  await page.goto("/");
  let posted = false;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith("/api/reviews")) posted = true; });
  await page.locator("#fileInput").setInputFiles({ name: "too-large.txt", mimeType: "text/plain", buffer: Buffer.alloc(20 * 1024 * 1024 + 1) });
  await expect(page.locator(".toast")).toContainText("20 MB");
  expect(posted).toBe(false);
});
