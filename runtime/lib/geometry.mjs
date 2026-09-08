const EPSILON = 1e-9;
const PORT_CORNER_CLEARANCE = 16;
const ROUTE_CLEARANCE = 16;
const SIDE_VECTORS = Object.freeze({
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
});

export function connectionGeometry(from, to, edge, context = {}) {
  if (arguments.length < 3 || edge == null) return legacyConnectionGeometry(from, to);
  const nodes = nodeMap(context.nodes ?? [from, to]);
  const edges = Array.isArray(context.edges) ? context.edges : [edge];
  const assignments = context.portAssignments ?? assignPorts(edges, nodes);
  return routeConnection(from, to, edge, { ...context, nodes, edges, portAssignments: assignments });
}

export function routeEdges(edges, nodes, context = {}) {
  const byNode = nodeMap(nodes);
  const ordered = [...edges].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const portAssignments = assignPorts(ordered, byNode);
  return new Map(ordered.map((edge) => {
    const from = byNode.get(String(edge.from));
    const to = byNode.get(String(edge.to));
    if (!from || !to) return [String(edge.id), null];
    return [String(edge.id), routeConnection(from, to, edge, {
      ...context,
      nodes: byNode,
      edges: ordered,
      portAssignments,
    })];
  }).filter(([, route]) => route));
}

export function routeConnection(from, to, edge = {}, context = {}) {
  const id = String(edge.id ?? `${from.id ?? "from"}->${to.id ?? "to"}`);
  const byNode = nodeMap(context.nodes ?? [from, to]);
  const assignments = context.portAssignments ?? assignPorts(context.edges ?? [edge], byNode);
  const fromPort = assignments.get(portKey(id, "from")) ?? singlePort(from, to, edge.fromSide, "from");
  const toPort = assignments.get(portKey(id, "to")) ?? singlePort(to, from, edge.toSide, "to");
  const obstacles = [...byNode.values()].filter((node) => node !== from && node !== to
    && String(node.id) !== String(from.id) && String(node.id) !== String(to.id));
  const via = normalizeWaypoints(edge.via ?? edge.data?.via);
  const absolutePoints = via.length > 0
    ? routeVia(fromPort.point, toPort.point, via, fromPort.side, toPort.side)
    : routeOrthogonal(fromPort.point, toPort.point, fromPort.side, toPort.side, obstacles);
  const cleanPoints = simplifyPoints(absolutePoints).map(pointTuple);
  const xs = cleanPoints.map(([x]) => x);
  const ys = cleanPoints.map(([, y]) => y);
  const x = round(Math.min(...xs));
  const y = round(Math.min(...ys));
  const relativePoints = cleanPoints.map(([pointX, pointY]) => [round(pointX - x), round(pointY - y)]);
  const explicitLabelAt = edge.labelAt ?? edge.data?.labelAt;
  let labelPoint = resolveLabelPoint(explicitLabelAt, cleanPoints);
  const labelBounds = makeLabelBounds(edge, labelPoint, context);
  if (explicitLabelAt == null && labelBounds.width > 0 && labelBounds.height > 0) {
    offsetDefaultLabel(labelBounds, labelPoint, cleanPoints);
    labelPoint = {
      x: round(labelBounds.x + labelBounds.width / 2),
      y: round(labelBounds.y + labelBounds.height / 2),
    };
  }
  return {
    id,
    edgeId: id,
    from: String(edge.from ?? from.id ?? ""),
    to: String(edge.to ?? to.id ?? ""),
    x,
    y,
    width: round(Math.max(...xs) - x),
    height: round(Math.max(...ys) - y),
    absolutePoints: cleanPoints,
    points: relativePoints,
    relativePoints,
    startFixedPoint: fromPort.fixedPoint,
    endFixedPoint: toPort.fixedPoint,
    fromSide: fromPort.side,
    toSide: toPort.side,
    labelPoint,
    labelBounds,
  };
}

export function assignPorts(edges, nodes) {
  const byNode = nodeMap(nodes);
  const groups = new Map();
  const descriptors = [];
  for (const edge of edges) {
    const id = String(edge.id ?? "");
    const from = byNode.get(String(edge.from));
    const to = byNode.get(String(edge.to));
    if (!from || !to) continue;
    const fromSide = normalizeSide(edge.fromSide ?? edge.data?.fromSide)
      ?? automaticSide(from, to, "from", from === to || String(from.id) === String(to.id));
    const toSide = normalizeSide(edge.toSide ?? edge.data?.toSide)
      ?? automaticSide(to, from, "to", from === to || String(from.id) === String(to.id));
    descriptors.push(
      endpointDescriptor(id, "from", from, to, fromSide),
      endpointDescriptor(id, "to", to, from, toSide),
    );
  }
  for (const descriptor of descriptors) {
    const key = `${String(descriptor.node.id)}\u0000${descriptor.side}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(descriptor);
  }

  const result = new Map();
  for (const group of groups.values()) {
    group.sort(compareEndpoints);
    group.forEach((descriptor, index) => {
      const fixedPoint = distributedFixedPoint(descriptor.node, descriptor.side, index, group.length);
      result.set(portKey(descriptor.edgeId, descriptor.role), {
        side: descriptor.side,
        fixedPoint,
        point: fixedPointToPoint(descriptor.node, fixedPoint),
      });
    });
  }
  return result;
}

export function checkNodeOverlaps(nodes) {
  const values = nodeValues(nodes).sort(compareIds);
  const issues = [];
  for (let index = 0; index < values.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < values.length; otherIndex += 1) {
      const first = values[index];
      const second = values[otherIndex];
      const overlap = intersectionBox(first, second);
      if (!overlap || overlap.width <= 0 || overlap.height <= 0) continue;
      issues.push(problem(
        "geometry.nodeOverlap",
        [itemId(first), itemId(second)],
        `${itemId(first)} overlaps ${itemId(second)}.`,
        { nodes: [itemId(first), itemId(second)], overlap, area: round(overlap.width * overlap.height) },
      ));
    }
  }
  return issues;
}

export function checkEdgesThroughNodes(routes, nodes) {
  const routeValues = routeEntries(routes);
  const nodeList = nodeValues(nodes).sort(compareIds);
  const issues = [];
  for (const route of routeValues) {
    const excluded = new Set([String(route.from ?? ""), String(route.to ?? "")]);
    const points = absoluteRoutePoints(route);
    for (const node of nodeList) {
      if (excluded.has(itemId(node))) continue;
      for (let index = 0; index < points.length - 1; index += 1) {
        if (!segmentIntersectsRectInterior(points[index], points[index + 1], node)) continue;
        issues.push(problem(
          "geometry.edgeThroughNode",
          routeId(route),
          `${routeId(route)} passes through ${itemId(node)}.`,
          {
            edgeId: routeId(route),
            nodeId: itemId(node),
            segmentIndex: index,
            segment: [pointTuple(points[index]), pointTuple(points[index + 1])],
            nodeBounds: boxEvidence(node),
          },
        ));
      }
    }
  }
  return issues;
}

export function checkProperCrossings(routes) {
  const values = routeEntries(routes);
  const issues = [];
  for (let firstIndex = 0; firstIndex < values.length; firstIndex += 1) {
    const firstPoints = absoluteRoutePoints(values[firstIndex]);
    for (let secondIndex = firstIndex + 1; secondIndex < values.length; secondIndex += 1) {
      const secondPoints = absoluteRoutePoints(values[secondIndex]);
      for (let a = 0; a < firstPoints.length - 1; a += 1) {
        for (let b = 0; b < secondPoints.length - 1; b += 1) {
          const intersection = properIntersection(firstPoints[a], firstPoints[a + 1], secondPoints[b], secondPoints[b + 1]);
          if (!intersection) continue;
          issues.push(problem(
            "geometry.properCrossing",
            [routeId(values[firstIndex]), routeId(values[secondIndex])],
            `${routeId(values[firstIndex])} properly crosses ${routeId(values[secondIndex])}.`,
            {
              edges: [routeId(values[firstIndex]), routeId(values[secondIndex])],
              segmentIndices: [a, b],
              point: roundedPoint(intersection),
            },
          ));
        }
      }
    }
  }
  return issues;
}

export function checkAmbiguousCorridors(routes, options = {}) {
  const minimumClearance = Number(options.minimumClearance ?? 8);
  const minimumOverlap = Number(options.minimumOverlap ?? 8);
  const segments = routeEntries(routes).flatMap((route) => routeSegments(route));
  const issues = [];
  for (let firstIndex = 0; firstIndex < segments.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < segments.length; secondIndex += 1) {
      const first = segments[firstIndex];
      const second = segments[secondIndex];
      if (first.edgeId === second.edgeId || first.orientation !== second.orientation || first.orientation === "diagonal") continue;
      const corridor = parallelCorridor(first, second);
      if (!corridor || corridor.distance >= minimumClearance || corridor.overlapLength < minimumOverlap) continue;
      issues.push(problem(
        "geometry.ambiguousCorridor",
        [first.edgeId, second.edgeId],
        `${first.edgeId} and ${second.edgeId} run in an ambiguous corridor.`,
        {
          edges: [first.edgeId, second.edgeId],
          segmentIndices: [first.index, second.index],
          orientation: first.orientation,
          distance: round(corridor.distance),
          overlapLength: round(corridor.overlapLength),
          minimumClearance,
          minimumOverlap,
        },
      ));
    }
  }
  return issues;
}

export function checkRouteSegmentRhythm(routes, options = {}) {
  const minimumLength = Number(options.minimumLength ?? 8);
  const minimumInteriorLength = Number(options.minimumInteriorLength ?? 16);
  const issues = [];
  for (const route of routeEntries(routes)) {
    const segments = routeSegments(route);
    for (const segment of segments) {
      const interior = segment.index > 0 && segment.index < segments.length - 1;
      const requiredLength = interior ? minimumInteriorLength : minimumLength;
      if (segment.length + EPSILON >= requiredLength) continue;
      issues.push(problem(
        "geometry.routeSegmentRhythm",
        routeId(route),
        `${routeId(route)} segment ${segment.index} is shorter than ${requiredLength}px.`,
        {
          edgeId: routeId(route),
          segmentIndex: segment.index,
          segment: [pointTuple(segment.a), pointTuple(segment.b)],
          length: round(segment.length),
          interior,
          requiredLength,
        },
      ));
    }
  }
  return issues;
}

export function checkLabelClearance(routes, nodes, options = {}) {
  return [
    ...checkLabelToNodeClearance(routes, nodes, options),
    ...checkLabelToRouteClearance(routes, options),
  ];
}

export function checkLabelToNodeClearance(routes, nodes, options = {}) {
  const minimumClearance = Number(options.minimumClearance ?? 8);
  const routeValues = routeEntries(routes);
  const nodeList = nodeValues(nodes).sort(compareIds);
  const issues = [];
  for (const route of routeValues) {
    const bounds = route.labelBounds;
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) continue;
    for (const node of nodeList) {
      const clearance = rectDistance(bounds, node);
      if (clearance + EPSILON >= minimumClearance) continue;
      issues.push(problem(
        "geometry.labelNodeClearance",
        routeId(route),
        `${routeId(route)} label is too close to ${itemId(node)}.`,
        {
          edgeId: routeId(route),
          nodeId: itemId(node),
          labelBounds: boxEvidence(bounds),
          nodeBounds: boxEvidence(node),
          clearance: round(clearance),
          requiredClearance: minimumClearance,
        },
      ));
    }
  }
  return issues;
}

export function checkLabelToRouteClearance(routes, options = {}) {
  const minimumClearance = Number(options.minimumClearance ?? 8);
  const routeValues = routeEntries(routes);
  const issues = [];
  for (const route of routeValues) {
    const bounds = route.labelBounds;
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) continue;
    for (const other of routeValues) {
      if (other === route) continue;
      const segments = routeSegments(other);
      const distances = segments.map((segment) => segmentRectDistance(segment.a, segment.b, bounds));
      const clearance = Math.min(...distances);
      if (clearance + EPSILON >= minimumClearance) continue;
      const segmentIndex = distances.indexOf(clearance);
      issues.push(problem(
        "geometry.labelRouteClearance",
        routeId(route),
        `${routeId(route)} label is too close to ${routeId(other)}.`,
        {
          edgeId: routeId(route),
          otherEdgeId: routeId(other),
          segmentIndex,
          labelBounds: boxEvidence(bounds),
          clearance: round(clearance),
          requiredClearance: minimumClearance,
        },
      ));
    }
  }
  return issues;
}

export function checkGeometry(input, options = {}) {
  const nodes = input?.nodes ?? [];
  const routes = input?.routes ?? [];
  return [
    ...checkNodeOverlaps(nodes),
    ...checkEdgesThroughNodes(routes, nodes),
    ...checkProperCrossings(routes),
    ...checkAmbiguousCorridors(routes, options.corridors),
    ...checkRouteSegmentRhythm(routes, options.rhythm),
    ...checkLabelClearance(routes, nodes, options.labels),
  ];
}

function legacyConnectionGeometry(from, to) {
  const a = center(from);
  const b = center(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let startFixedPoint;
  let endFixedPoint;
  let start;
  let end;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const rightward = dx >= 0;
    startFixedPoint = [rightward ? 1 : 0, 0.5];
    endFixedPoint = [rightward ? 0 : 1, 0.5];
    start = { x: rightward ? from.x + from.width : from.x, y: a.y };
    end = { x: rightward ? to.x : to.x + to.width, y: b.y };
  } else {
    const downward = dy >= 0;
    startFixedPoint = [0.5, downward ? 1 : 0];
    endFixedPoint = [0.5, downward ? 0 : 1];
    start = { x: a.x, y: downward ? from.y + from.height : from.y };
    end = { x: b.x, y: downward ? to.y : to.y + to.height };
  }
  return {
    x: round(start.x),
    y: round(start.y),
    width: round(Math.abs(end.x - start.x)),
    height: round(Math.abs(end.y - start.y)),
    points: [[0, 0], [round(end.x - start.x), round(end.y - start.y)]],
    startFixedPoint,
    endFixedPoint,
  };
}

function endpointDescriptor(edgeId, role, node, counterpart, side) {
  return { edgeId, role, node, counterpart, side, counterpartCenter: center(counterpart) };
}

function compareEndpoints(first, second) {
  const verticalSide = first.side === "left" || first.side === "right";
  const primary = verticalSide
    ? first.counterpartCenter.y - second.counterpartCenter.y
    : first.counterpartCenter.x - second.counterpartCenter.x;
  const secondary = verticalSide
    ? first.counterpartCenter.x - second.counterpartCenter.x
    : first.counterpartCenter.y - second.counterpartCenter.y;
  return primary || secondary || first.edgeId.localeCompare(second.edgeId) || first.role.localeCompare(second.role);
}

function distributedFixedPoint(node, side, index, count) {
  const dimension = side === "left" || side === "right" ? Number(node.height) : Number(node.width);
  const safeClearance = Math.min(PORT_CORNER_CLEARANCE, Math.max(0, dimension / 2));
  const minimum = dimension > 0 ? safeClearance / dimension : 0.5;
  const maximum = 1 - minimum;
  const fraction = count === 1 ? 0.5 : minimum + ((maximum - minimum) * index) / (count - 1);
  if (side === "left") return [0, round(fraction, 6)];
  if (side === "right") return [1, round(fraction, 6)];
  if (side === "top") return [round(fraction, 6), 0];
  return [round(fraction, 6), 1];
}

function singlePort(node, counterpart, explicitSide, role) {
  const side = normalizeSide(explicitSide) ?? automaticSide(node, counterpart, role, node === counterpart);
  const fixedPoint = distributedFixedPoint(node, side, 0, 1);
  return { side, fixedPoint, point: fixedPointToPoint(node, fixedPoint) };
}

function automaticSide(node, counterpart, role, self) {
  if (self) return role === "from" ? "right" : "bottom";
  const own = center(node);
  const other = center(counterpart);
  const dx = other.x - own.x;
  const dy = other.y - own.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

function normalizeSide(value) {
  const aliases = { n: "top", north: "top", e: "right", east: "right", s: "bottom", south: "bottom", w: "left", west: "left" };
  const side = String(value ?? "").toLowerCase();
  return Object.hasOwn(SIDE_VECTORS, side) ? side : aliases[side] ?? null;
}

function fixedPointToPoint(node, fixedPoint) {
  return {
    x: round(Number(node.x) + Number(node.width) * fixedPoint[0]),
    y: round(Number(node.y) + Number(node.height) * fixedPoint[1]),
  };
}

function routeOrthogonal(start, end, fromSide, toSide, obstacles) {
  if (nearAligned(start, end) && clearSegment(start, end, obstacles)) return [start, end];
  const startLead = offsetPoint(start, fromSide, ROUTE_CLEARANCE);
  const endLead = offsetPoint(end, toSide, ROUTE_CLEARANCE);
  const candidates = middleCandidates(startLead, endLead, obstacles).map((middle) => [start, startLead, ...middle, endLead, end]);
  candidates.sort((first, second) => routeScore(first, obstacles) - routeScore(second, obstacles)
    || comparePointLists(first, second));
  return candidates[0] ?? [start, startLead, { x: endLead.x, y: startLead.y }, endLead, end];
}

function middleCandidates(start, end, obstacles) {
  const aligned = sameCoordinate(start.x, end.x) || sameCoordinate(start.y, end.y);
  const candidates = aligned ? [[start, end]] : [
    [start, { x: end.x, y: start.y }, end],
    [start, { x: start.x, y: end.y }, end],
    [start, { x: round((start.x + end.x) / 2), y: start.y }, { x: round((start.x + end.x) / 2), y: end.y }, end],
    [start, { x: start.x, y: round((start.y + end.y) / 2) }, { x: end.x, y: round((start.y + end.y) / 2) }, end],
  ];
  for (const obstacle of obstacles) {
    for (const x of [Number(obstacle.x) - ROUTE_CLEARANCE, Number(obstacle.x) + Number(obstacle.width) + ROUTE_CLEARANCE]) {
      candidates.push([start, { x, y: start.y }, { x, y: end.y }, end]);
    }
    for (const y of [Number(obstacle.y) - ROUTE_CLEARANCE, Number(obstacle.y) + Number(obstacle.height) + ROUTE_CLEARANCE]) {
      candidates.push([start, { x: start.x, y }, { x: end.x, y }, end]);
    }
  }
  return candidates;
}

function routeVia(start, end, via, fromSide, toSide) {
  const startLead = offsetPoint(start, fromSide, ROUTE_CLEARANCE);
  const endLead = offsetPoint(end, toSide, ROUTE_CLEARANCE);
  const anchors = [startLead, ...via, endLead];
  const points = [start, startLead];
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const first = anchors[index];
    const second = anchors[index + 1];
    if (!sameCoordinate(first.x, second.x) && !sameCoordinate(first.y, second.y)) {
      points.push({ x: second.x, y: first.y });
    }
    points.push(second);
  }
  points.push(end);
  return points;
}

function routeScore(points, obstacles) {
  let intersections = 0;
  let length = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    length += distance(points[index], points[index + 1]);
    intersections += obstacles.filter((box) => segmentIntersectsRectInterior(points[index], points[index + 1], box)).length;
  }
  return intersections * 1e9 + points.length * 1e5 + length;
}

function comparePointLists(first, second) {
  return JSON.stringify(first.map(pointTuple)).localeCompare(JSON.stringify(second.map(pointTuple)));
}

function nearAligned(first, second) {
  return Math.abs(first.x - second.x) <= 8 || Math.abs(first.y - second.y) <= 8;
}

function clearSegment(first, second, obstacles) {
  return obstacles.every((box) => !segmentIntersectsRectInterior(first, second, box));
}

function offsetPoint(point, side, amount) {
  const vector = SIDE_VECTORS[side];
  return { x: round(point.x + vector.x * amount), y: round(point.y + vector.y * amount) };
}

function normalizeWaypoints(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizePoint).filter(Boolean);
}

function normalizePoint(value) {
  const x = Array.isArray(value) ? value[0] : value?.x;
  const y = Array.isArray(value) ? value[1] : value?.y;
  return Number.isFinite(Number(x)) && Number.isFinite(Number(y)) ? { x: Number(x), y: Number(y) } : null;
}

function simplifyPoints(points) {
  const unique = points.filter((point, index) => index === 0 || !samePoint(point, points[index - 1]));
  const result = [];
  for (const point of unique) {
    const previous = result.at(-1);
    const beforePrevious = result.at(-2);
    if (beforePrevious && previous && collinear(beforePrevious, previous, point) && pointBetween(previous, beforePrevious, point)) {
      result[result.length - 1] = point;
    }
    else result.push(point);
  }
  return result;
}

function resolveLabelPoint(labelAt, points) {
  const explicit = normalizePoint(labelAt);
  if (explicit) return roundedPoint(explicit);
  const ratio = typeof labelAt === "number" ? labelAt : Number(labelAt?.ratio ?? labelAt?.position);
  return roundedPoint(pointAlongPolyline(points.map(pointObject), Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0.5));
}

function makeLabelBounds(edge, labelPoint, context) {
  const explicit = edge.labelBounds ?? edge.data?.labelBounds;
  if (explicit && [explicit.width, explicit.height].every((value) => Number.isFinite(Number(value)))) {
    return {
      x: round(Number(explicit.x ?? labelPoint.x - Number(explicit.width) / 2)),
      y: round(Number(explicit.y ?? labelPoint.y - Number(explicit.height) / 2)),
      width: round(Number(explicit.width)),
      height: round(Number(explicit.height)),
    };
  }
  const label = String(edge.label ?? "");
  if (!label) return { x: labelPoint.x, y: labelPoint.y, width: 0, height: 0 };
  const measured = typeof context.measureLabel === "function" ? context.measureLabel(label, edge) : null;
  const width = Number(measured?.width ?? Math.max(32, Math.min(240, label.length * 9 + 16)));
  const height = Number(measured?.height ?? 28);
  return { x: round(labelPoint.x - width / 2), y: round(labelPoint.y - height / 2), width: round(width), height: round(height) };
}

function offsetDefaultLabel(bounds, point, points) {
  const segments = points.slice(0, -1).map((start, index) => ({
    start: pointObject(start),
    end: pointObject(points[index + 1]),
  }));
  segments.sort((first, second) => pointSegmentDistance(point, first.start, first.end)
    - pointSegmentDistance(point, second.start, second.end));
  const segment = segments[0];
  if (!segment) return;
  if (sameCoordinate(segment.start.x, segment.end.x)) {
    bounds.x = round(bounds.x + bounds.width / 2 + 8);
  } else {
    bounds.y = round(bounds.y - bounds.height / 2 - 8);
  }
}

function pointAlongPolyline(points, ratio) {
  const lengths = points.slice(0, -1).map((point, index) => distance(point, points[index + 1]));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= EPSILON) return points[0] ?? { x: 0, y: 0 };
  let remaining = total * ratio;
  for (let index = 0; index < lengths.length; index += 1) {
    if (remaining <= lengths[index] || index === lengths.length - 1) {
      const fraction = lengths[index] <= EPSILON ? 0 : remaining / lengths[index];
      return {
        x: points[index].x + (points[index + 1].x - points[index].x) * fraction,
        y: points[index].y + (points[index + 1].y - points[index].y) * fraction,
      };
    }
    remaining -= lengths[index];
  }
  return points.at(-1);
}

function routeEntries(routes) {
  const values = routes instanceof Map ? [...routes.values()] : Array.isArray(routes) ? routes : Object.values(routes ?? {});
  return values.filter(Boolean).sort((a, b) => routeId(a).localeCompare(routeId(b)));
}

function nodeValues(nodes) {
  return nodes instanceof Map ? [...nodes.values()] : Array.isArray(nodes) ? [...nodes] : Object.values(nodes ?? {});
}

function nodeMap(nodes) {
  if (nodes instanceof Map) return new Map([...nodes].map(([key, node]) => [String(node.id ?? key), node]));
  return new Map(nodeValues(nodes).map((node) => [String(node.id), node]));
}

function absoluteRoutePoints(route) {
  if (Array.isArray(route.absolutePoints)) return route.absolutePoints.map(pointObject);
  return (route.points ?? []).map((point) => {
    const normalized = pointObject(point);
    return { x: Number(route.x ?? 0) + normalized.x, y: Number(route.y ?? 0) + normalized.y };
  });
}

function routeSegments(route) {
  const points = absoluteRoutePoints(route);
  return points.slice(0, -1).map((a, index) => {
    const b = points[index + 1];
    return {
      edgeId: routeId(route),
      index,
      a,
      b,
      length: distance(a, b),
      orientation: sameCoordinate(a.x, b.x) ? "vertical" : sameCoordinate(a.y, b.y) ? "horizontal" : "diagonal",
    };
  });
}

function parallelCorridor(first, second) {
  if (first.orientation === "horizontal") {
    const overlapLength = intervalOverlap(first.a.x, first.b.x, second.a.x, second.b.x);
    return { distance: Math.abs(first.a.y - second.a.y), overlapLength };
  }
  if (first.orientation === "vertical") {
    const overlapLength = intervalOverlap(first.a.y, first.b.y, second.a.y, second.b.y);
    return { distance: Math.abs(first.a.x - second.a.x), overlapLength };
  }
  return null;
}

function intervalOverlap(a1, a2, b1, b2) {
  return Math.max(0, Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2)));
}

function segmentIntersectsRectInterior(a, b, box) {
  const inset = {
    x: Number(box.x) + EPSILON,
    y: Number(box.y) + EPSILON,
    width: Math.max(0, Number(box.width) - EPSILON * 2),
    height: Math.max(0, Number(box.height) - EPSILON * 2),
  };
  if (pointInRect(a, inset) || pointInRect(b, inset)) return true;
  const corners = rectEdges(inset);
  return corners.some(([c, d]) => segmentIntersection(a, b, c, d));
}

function properIntersection(a, b, c, d) {
  const denominator = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(denominator) <= EPSILON) return null;
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / denominator;
  const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / denominator;
  if (t <= EPSILON || t >= 1 - EPSILON || u <= EPSILON || u >= 1 - EPSILON) return null;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

function segmentIntersection(a, b, c, d) {
  const orientation = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const values = [orientation(a, b, c), orientation(a, b, d), orientation(c, d, a), orientation(c, d, b)];
  if (((values[0] > EPSILON && values[1] < -EPSILON) || (values[0] < -EPSILON && values[1] > EPSILON))
    && ((values[2] > EPSILON && values[3] < -EPSILON) || (values[2] < -EPSILON && values[3] > EPSILON))) return true;
  return pointOnSegment(c, a, b) || pointOnSegment(d, a, b) || pointOnSegment(a, c, d) || pointOnSegment(b, c, d);
}

function pointOnSegment(point, a, b) {
  const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
  return Math.abs(cross) <= EPSILON
    && point.x >= Math.min(a.x, b.x) - EPSILON && point.x <= Math.max(a.x, b.x) + EPSILON
    && point.y >= Math.min(a.y, b.y) - EPSILON && point.y <= Math.max(a.y, b.y) + EPSILON;
}

function rectDistance(first, second) {
  const dx = Math.max(Number(first.x) - (Number(second.x) + Number(second.width)), Number(second.x) - (Number(first.x) + Number(first.width)), 0);
  const dy = Math.max(Number(first.y) - (Number(second.y) + Number(second.height)), Number(second.y) - (Number(first.y) + Number(first.height)), 0);
  return Math.hypot(dx, dy);
}

function segmentRectDistance(a, b, box) {
  if (segmentIntersectsRectInterior(a, b, box) || pointInRect(a, box) || pointInRect(b, box)) return 0;
  return Math.min(...rectEdges(box).map(([c, d]) => segmentDistance(a, b, c, d)));
}

function segmentDistance(a, b, c, d) {
  if (segmentIntersection(a, b, c, d)) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}

function pointSegmentDistance(point, a, b) {
  const lengthSquared = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (lengthSquared <= EPSILON) return distance(point, a);
  const ratio = Math.max(0, Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / lengthSquared));
  return distance(point, { x: a.x + ratio * (b.x - a.x), y: a.y + ratio * (b.y - a.y) });
}

function rectEdges(box) {
  const left = Number(box.x);
  const top = Number(box.y);
  const right = left + Number(box.width);
  const bottom = top + Number(box.height);
  const topLeft = { x: left, y: top };
  const topRight = { x: right, y: top };
  const bottomRight = { x: right, y: bottom };
  const bottomLeft = { x: left, y: bottom };
  return [[topLeft, topRight], [topRight, bottomRight], [bottomRight, bottomLeft], [bottomLeft, topLeft]];
}

function pointInRect(point, box) {
  return point.x >= Number(box.x) && point.x <= Number(box.x) + Number(box.width)
    && point.y >= Number(box.y) && point.y <= Number(box.y) + Number(box.height);
}

function intersectionBox(first, second) {
  const x = Math.max(Number(first.x), Number(second.x));
  const y = Math.max(Number(first.y), Number(second.y));
  const right = Math.min(Number(first.x) + Number(first.width), Number(second.x) + Number(second.width));
  const bottom = Math.min(Number(first.y) + Number(first.height), Number(second.y) + Number(second.height));
  return right > x && bottom > y ? { x: round(x), y: round(y), width: round(right - x), height: round(bottom - y) } : null;
}

function problem(code, subject, message, evidence) {
  return { code, severity: "warning", message, subject, evidence, supportedFixes: ["reflow"] };
}

function boxEvidence(box) {
  return { x: round(box.x), y: round(box.y), width: round(box.width), height: round(box.height) };
}

function center(node) {
  return { x: Number(node.x) + Number(node.width) / 2, y: Number(node.y) + Number(node.height) / 2 };
}

function pointObject(point) {
  return Array.isArray(point) ? { x: Number(point[0]), y: Number(point[1]) } : { x: Number(point.x), y: Number(point.y) };
}

function pointTuple(point) {
  const normalized = pointObject(point);
  return [round(normalized.x), round(normalized.y)];
}

function roundedPoint(point) {
  return { x: round(point.x), y: round(point.y) };
}

function distance(first, second) {
  return Math.hypot(Number(second.x) - Number(first.x), Number(second.y) - Number(first.y));
}

function sameCoordinate(first, second) {
  return Math.abs(Number(first) - Number(second)) <= EPSILON;
}

function samePoint(first, second) {
  return sameCoordinate(first.x, second.x) && sameCoordinate(first.y, second.y);
}

function collinear(a, b, c) {
  return sameCoordinate((b.x - a.x) * (c.y - b.y), (b.y - a.y) * (c.x - b.x));
}

function pointBetween(point, a, b) {
  return point.x >= Math.min(a.x, b.x) - EPSILON && point.x <= Math.max(a.x, b.x) + EPSILON
    && point.y >= Math.min(a.y, b.y) - EPSILON && point.y <= Math.max(a.y, b.y) + EPSILON;
}

function portKey(edgeId, role) {
  return `${edgeId}\u0000${role}`;
}

function routeId(route) {
  return String(route.edgeId ?? route.id ?? "route");
}

function itemId(item) {
  return String(item.id ?? item.semanticId ?? "item");
}

function compareIds(first, second) {
  return itemId(first).localeCompare(itemId(second));
}

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(Number(value) * factor) / factor;
}
