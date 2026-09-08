import assert from "node:assert/strict";
import test from "node:test";

import {
  checkAmbiguousCorridors,
  checkEdgesThroughNodes,
  checkGeometry,
  checkLabelClearance,
  checkNodeOverlaps,
  checkProperCrossings,
  checkRouteSegmentRhythm,
  connectionGeometry,
  routeEdges,
} from "../runtime/lib/geometry.mjs";
import { layoutDiagram } from "../runtime/lib/layout.mjs";

const nodes = new Map([
  ["source", box("source", 0, 100, 100, 80)],
  ["high", box("high", 300, 0, 100, 80)],
  ["middle", box("middle", 300, 100, 100, 80)],
  ["low", box("low", 300, 200, 100, 80)],
]);

test("shared endpoint ports are stable, geometrically ordered, and keep corner clearance", () => {
  const edges = [
    { id: "edge-low", from: "source", to: "low" },
    { id: "edge-high", from: "source", to: "high" },
    { id: "edge-middle", from: "source", to: "middle" },
  ];
  const first = routeEdges(edges, nodes);
  const reversed = routeEdges([...edges].reverse(), nodes);
  assert.deepEqual([...first], [...reversed]);
  assert.deepEqual(first.get("edge-high").startFixedPoint, [1, 0.2]);
  assert.deepEqual(first.get("edge-middle").startFixedPoint, [1, 0.5]);
  assert.deepEqual(first.get("edge-low").startFixedPoint, [1, 0.8]);
  assert.equal(first.get("edge-high").absolutePoints[0][1], 116);
  assert.equal(first.get("edge-low").absolutePoints[0][1], 164);
});

test("stable edge id breaks equal counterpart geometry ties", () => {
  const tiedNodes = new Map(nodes);
  tiedNodes.set("same", box("same", 300, 100, 100, 80));
  const routes = routeEdges([
    { id: "z", from: "source", to: "same" },
    { id: "a", from: "source", to: "middle" },
  ], tiedNodes);
  assert.ok(routes.get("a").startFixedPoint[1] < routes.get("z").startFixedPoint[1]);
});

test("explicit sides, waypoints, and label position take priority", () => {
  const edge = {
    id: "controlled",
    from: "source",
    to: "middle",
    fromSide: "top",
    toSide: "bottom",
    via: [{ x: 180, y: 40 }, { x: 260, y: 220 }],
    label: "controlled",
    labelAt: { x: 210, y: 30 },
  };
  const route = connectionGeometry(nodes.get("source"), nodes.get("middle"), edge, { nodes, edges: [edge] });
  assert.equal(route.fromSide, "top");
  assert.equal(route.toSide, "bottom");
  assert.deepEqual(route.startFixedPoint, [0.5, 0]);
  assert.deepEqual(route.endFixedPoint, [0.5, 1]);
  assert.ok(route.absolutePoints.some(([x, y]) => x === 180 && y === 40));
  assert.ok(route.absolutePoints.some(([x, y]) => x === 260 && y === 220));
  assert.deepEqual(route.labelPoint, { x: 210, y: 30 });
  assert.equal(route.labelBounds.x + route.labelBounds.width / 2, 210);
});

test("routes expose absolute and relative orthogonal geometry", () => {
  const from = box("a", 0, 0, 100, 80);
  const to = box("b", 300, 180, 100, 80);
  const route = connectionGeometry(from, to, { id: "ab", from: "a", to: "b" }, { nodes: [from, to] });
  assert.ok(route.absolutePoints.length >= 3);
  assert.equal(route.absolutePoints.every((point, index, points) => index === 0
    || point[0] === points[index - 1][0] || point[1] === points[index - 1][1]), true);
  assert.deepEqual(route.points, route.absolutePoints.map(([x, y]) => [x - route.x, y - route.y]));
  assert.equal(route.width, Math.max(...route.absolutePoints.map(([x]) => x)) - route.x);
  assert.equal(route.height, Math.max(...route.absolutePoints.map(([, y]) => y)) - route.y);

  const aligned = connectionGeometry(from, box("c", 300, 0, 100, 80), { id: "ac", from: "a", to: "c" });
  assert.equal(aligned.absolutePoints.length, 2);

  const nearlyAligned = connectionGeometry(from, box("d", 300, 6, 100, 80), { id: "ad", from: "a", to: "d" });
  assert.equal(nearlyAligned.absolutePoints.length, 2);
});

test("an aligned route detours around an intervening node", () => {
  const from = box("a", 0, 0, 100, 80);
  const blocker = box("blocker", 150, -10, 50, 100);
  const to = box("b", 300, 0, 100, 80);
  const route = connectionGeometry(
    from,
    to,
    { id: "ab", from: "a", to: "b" },
    { nodes: [from, blocker, to] },
  );
  assert.ok(route.absolutePoints.length > 2);
  assert.equal(checkEdgesThroughNodes([route], [blocker]).length, 0);
});

test("legacy two-argument connection geometry remains compatible", () => {
  assert.deepEqual(
    connectionGeometry(box("a", 0, 0, 100, 80), box("b", 300, 180, 100, 80)),
    {
      x: 100,
      y: 40,
      width: 200,
      height: 180,
      points: [[0, 0], [200, 180]],
      startFixedPoint: [1, 0.5],
      endFixedPoint: [0, 0.5],
    },
  );
});

test("layout includes one complete route per edge", () => {
  const spec = {
    type: "flowchart",
    layout: {},
    nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    edges: [{ id: "ab", from: "a", to: "b", label: "next" }],
    groups: [],
    lanes: [],
  };
  const layout = layoutDiagram(spec);
  assert.ok(layout.routes instanceof Map);
  assert.deepEqual([...layout.routes.keys()], ["ab"]);
  for (const key of ["absolutePoints", "points", "x", "y", "width", "height", "startFixedPoint", "endFixedPoint", "fromSide", "toSide", "labelPoint", "labelBounds"]) {
    assert.ok(key in layout.routes.get("ab"), key);
  }
});

test("node overlap reports exact overlap evidence", () => {
  const issues = checkNodeOverlaps([box("a", 0, 0, 20, 20), box("b", 10, 5, 20, 20)]);
  assert.equal(issues[0].code, "geometry.nodeOverlap");
  assert.deepEqual(issues[0].evidence, {
    nodes: ["a", "b"],
    overlap: { x: 10, y: 5, width: 10, height: 15 },
    area: 150,
  });
});

test("edge-through-node reports route segment and node bounds", () => {
  const route = simpleRoute("edge", [[0, 10], [100, 10]], { from: "from", to: "to" });
  const issues = checkEdgesThroughNodes([route], [box("blocker", 40, 0, 20, 20)]);
  assert.equal(issues[0].code, "geometry.edgeThroughNode");
  assert.deepEqual(issues[0].evidence.segment, [[0, 10], [100, 10]]);
  assert.deepEqual(issues[0].evidence.nodeBounds, { x: 40, y: 0, width: 20, height: 20 });
});

test("proper crossing excludes endpoint touches and reports intersection", () => {
  const crossing = checkProperCrossings([
    simpleRoute("horizontal", [[0, 10], [20, 10]]),
    simpleRoute("vertical", [[10, 0], [10, 20]]),
  ]);
  assert.deepEqual(crossing[0].evidence.point, { x: 10, y: 10 });
  assert.equal(checkProperCrossings([
    simpleRoute("a", [[0, 0], [10, 0]]),
    simpleRoute("b", [[10, 0], [10, 10]]),
  ]).length, 0);
});

test("ambiguous parallel corridors require 8px overlap and clearance", () => {
  const issues = checkAmbiguousCorridors([
    simpleRoute("a", [[0, 0], [30, 0]]),
    simpleRoute("b", [[10, 6], [40, 6]]),
  ]);
  assert.equal(issues[0].code, "geometry.ambiguousCorridor");
  assert.equal(issues[0].evidence.distance, 6);
  assert.equal(issues[0].evidence.overlapLength, 20);
  assert.equal(checkAmbiguousCorridors([
    simpleRoute("a", [[0, 0], [10, 0]]),
    simpleRoute("b", [[5, 6], [12, 6]]),
  ]).length, 0);
});

test("route rhythm distinguishes endpoint and interior minimum lengths", () => {
  const issues = checkRouteSegmentRhythm([
    simpleRoute("rhythm", [[0, 0], [7, 0], [7, 15], [27, 15]]),
  ]);
  assert.deepEqual(issues.map((issue) => issue.evidence), [
    { edgeId: "rhythm", segmentIndex: 0, segment: [[0, 0], [7, 0]], length: 7, interior: false, requiredLength: 8 },
    { edgeId: "rhythm", segmentIndex: 1, segment: [[7, 0], [7, 15]], length: 15, interior: true, requiredLength: 16 },
  ]);
});

test("label clearance checks nodes and unrelated routes", () => {
  const labeled = simpleRoute("label", [[0, 0], [100, 0]], {
    labelBounds: { x: 40, y: 10, width: 20, height: 10 },
  });
  const nearby = simpleRoute("nearby", [[0, 25], [100, 25]]);
  const issues = checkLabelClearance([labeled, nearby], [box("node", 62, 10, 10, 10)]);
  assert.deepEqual(issues.map((issue) => issue.code), [
    "geometry.labelNodeClearance",
    "geometry.labelRouteClearance",
  ]);
  assert.equal(issues[0].evidence.clearance, 2);
  assert.equal(issues[1].evidence.clearance, 5);
});

test("aggregate geometry check includes every quality category", () => {
  const routes = [
    simpleRoute("horizontal", [[0, 10], [7, 10], [20, 10]], { labelBounds: { x: 8, y: 1, width: 4, height: 4 } }),
    simpleRoute("vertical", [[10, 0], [10, 20]]),
    simpleRoute("corridor", [[0, 15], [20, 15]]),
  ];
  const result = checkGeometry({
    nodes: [box("a", 8, 8, 4, 4), box("b", 10, 10, 4, 4)],
    routes,
  });
  for (const code of ["geometry.nodeOverlap", "geometry.edgeThroughNode", "geometry.properCrossing", "geometry.ambiguousCorridor", "geometry.routeSegmentRhythm", "geometry.labelNodeClearance", "geometry.labelRouteClearance"]) {
    assert.ok(result.some((issue) => issue.code === code), code);
  }
});

function box(id, x, y, width, height) {
  return { id, x, y, width, height };
}

function simpleRoute(id, absolutePoints, extra = {}) {
  return {
    id,
    edgeId: id,
    absolutePoints,
    labelBounds: null,
    ...extra,
  };
}
