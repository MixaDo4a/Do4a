import assert from "node:assert/strict";
import test from "node:test";
import { aggregateCheckMetrics } from "./check-metrics.ts";

test("aggregates revenue and items by all receipts rather than averaging shifts", () => {
  const result = aggregateCheckMetrics([
    { revenue: 1000, receiptCount: 10, itemsSoldCount: 20 },
    { revenue: 900, receiptCount: 2, itemsSoldCount: 6 },
  ]);
  assert.equal(result.receiptCount, 12);
  assert.equal(result.averageCheck, 1900 / 12);
  assert.equal(result.checkDepth, 26 / 12);
});

test("missing receipt data does not create a zero-valued KPI", () => {
  assert.deepEqual(aggregateCheckMetrics([]), { receiptCount: 0, averageCheck: null, checkDepth: null });
  assert.deepEqual(
    aggregateCheckMetrics([{ revenue: 100, receiptCount: 0, itemsSoldCount: 0 }]),
    { receiptCount: 0, averageCheck: null, checkDepth: null },
  );
});

test("missing item count keeps check depth unresolved", () => {
  const result = aggregateCheckMetrics([
    { revenue: 1000, receiptCount: 10, itemsSoldCount: 20 },
    { revenue: 500, receiptCount: 5, itemsSoldCount: null },
  ]);
  assert.equal(result.averageCheck, 100);
  assert.equal(result.checkDepth, null);
});

test("net revenue can be negative when returns exceed sales", () => {
  const result = aggregateCheckMetrics([
    { revenue: -100, receiptCount: 2, itemsSoldCount: 3 },
    { revenue: 500, receiptCount: 8, itemsSoldCount: 12 },
  ]);
  assert.equal(result.averageCheck, 40);
  assert.equal(result.checkDepth, 1.5);
});
