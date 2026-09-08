import {
  DEFAULT_FONT_SIZES,
  normalizeSpec,
  round,
  RUNTIME_VERSION,
  stableId,
} from "./core.mjs";
import { hashSpec } from "./formats.mjs";
import { layoutDiagram } from "./layout.mjs";

export const DRAWIO_FORMAT_VERSION = 1;

export function compileDrawio(input) {
  const spec = normalizeSpec(input);
  const layout = layoutDiagram(spec);
  const specHash = hashSpec(spec);
  const nodeIds = new Map(spec.nodes.map((node) => [
    node.id,
    stableId("mx-node", spec.documentId, node.id),
  ]));
  const frameIds = new Map(layout.frames.map((frame) => [
    frame.semanticId,
    stableId("mx-frame", spec.documentId, frame.semanticId),
  ]));
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<mxfile compressed="false" pages="1" documentId="${xml(spec.documentId)}" specHash="${specHash}" runtimeVersion="${xml(RUNTIME_VERSION)}" schemaVersion="${spec.schemaVersion}" formatVersion="${DRAWIO_FORMAT_VERSION}">`,
    `  <diagram id="${xml(stableId("mx-page", spec.documentId, "page-1"))}" name="${xml(spec.title)}">`,
    "    <mxGraphModel dx=\"0\" dy=\"0\" grid=\"1\" gridSize=\"10\" guides=\"1\" tooltips=\"1\" connect=\"1\" arrows=\"1\" fold=\"1\" page=\"1\" pageScale=\"1\" pageWidth=\"1169\" pageHeight=\"827\" math=\"0\" shadow=\"0\" htmlLabels=\"0\">",
    "      <root>",
    '        <mxCell id="0"/>',
    '        <mxCell id="1" parent="0"/>',
  ];

  for (const frame of layout.frames) {
    const isLane = frame.semanticId.startsWith("lane:");
    const style = isLane
      ? `swimlane;horizontal=0;startSize=44;rounded=0;html=0;whiteSpace=wrap;fontSize=${DEFAULT_FONT_SIZES.frame};fontStyle=1;`
      : `rounded=1;dashed=1;container=1;collapsible=0;html=0;whiteSpace=wrap;fillColor=none;fontSize=${DEFAULT_FONT_SIZES.frame};fontStyle=1;align=left;verticalAlign=top;spacingTop=8;spacingLeft=8;`;
    lines.push(
      `        <mxCell id="${xml(frameIds.get(frame.semanticId))}" value="${xml(frame.label)}" style="${style}" vertex="1" parent="1">`,
      `          <mxGeometry x="${number(frame.x)}" y="${number(frame.y)}" width="${number(frame.width)}" height="${number(frame.height)}" as="geometry"/>`,
      "        </mxCell>",
    );
  }

  for (const nodeSpec of spec.nodes) {
    const node = layout.nodes.get(nodeSpec.id);
    const frame = node.frameSemanticId
      ? layout.frames.find((item) => item.semanticId === node.frameSemanticId)
      : null;
    const parent = frame ? frameIds.get(frame.semanticId) : "1";
    const x = frame ? node.x - frame.x : node.x;
    const y = frame ? node.y - frame.y : node.y;
    lines.push(
      `        <mxCell id="${xml(nodeIds.get(nodeSpec.id))}" value="${xml(nodeSpec.label)}" style="${nodeStyle(node, nodeSpec, spec)}" vertex="1" parent="${xml(parent)}">`,
      `          <mxGeometry x="${number(x)}" y="${number(y)}" width="${number(node.width)}" height="${number(node.height)}" as="geometry"/>`,
      "        </mxCell>",
    );
  }

  for (const edge of spec.edges) {
    const edgeId = stableId("mx-edge", spec.documentId, edge.id);
    const route = layout.routes.get(edge.id);
    const waypoints = route?.absolutePoints.slice(1, -1) ?? [];
    lines.push(
      `        <mxCell id="${xml(edgeId)}" value="${xml(edge.label)}" style="${edgeStyle(edge, spec, route)}" edge="1" parent="1" source="${xml(nodeIds.get(edge.from))}" target="${xml(nodeIds.get(edge.to))}">`,
      ...(waypoints.length === 0
        ? ['          <mxGeometry relative="1" as="geometry"/>']
        : [
            '          <mxGeometry relative="1" as="geometry">',
            '            <Array as="points">',
            ...waypoints.map(([x, y]) => `              <mxPoint x="${number(x)}" y="${number(y)}"/>`),
            "            </Array>",
            "          </mxGeometry>",
          ]),
      "        </mxCell>",
    );
  }

  for (const [index, annotation] of spec.annotations.entries()) {
    const annotationId = stableId("mx-annotation", spec.documentId, annotation.id ?? `annotation-${index + 1}`);
    lines.push(
      `        <mxCell id="${xml(annotationId)}" value="${xml(annotation.text ?? "")}" style="${annotationStyle(annotation, spec)}" vertex="1" parent="1">`,
      `          <mxGeometry x="${number(annotation.position?.x ?? 80)}" y="${number(annotation.position?.y ?? 40)}" width="${number(annotation.size?.width ?? 360)}" height="${number(annotation.size?.height ?? 64)}" as="geometry"/>`,
      "        </mxCell>",
    );
  }

  lines.push(
    "      </root>",
    "    </mxGraphModel>",
    "  </diagram>",
    "</mxfile>",
    "",
  );
  return {
    content: lines.join("\n"),
    spec,
    layout,
    formatVersion: DRAWIO_FORMAT_VERSION,
    warnings: [],
  };
}

function nodeStyle(node, nodeSpec, spec) {
  const shape = node.shape === "ellipse"
    ? "ellipse;"
    : node.shape === "diamond"
      ? "rhombus;"
      : "rounded=1;arcSize=12;";
  const fill = color(nodeSpec.style?.backgroundColor, spec.theme.primary);
  const stroke = color(nodeSpec.style?.strokeColor, spec.theme.stroke);
  const font = color(nodeSpec.style?.textColor, spec.theme.text);
  const fontSize = number(nodeSpec.style?.fontSize ?? DEFAULT_FONT_SIZES.node);
  return `${shape}whiteSpace=wrap;html=0;align=center;verticalAlign=middle;fillColor=${fill};strokeColor=${stroke};fontColor=${font};fontSize=${fontSize};`;
}

function edgeStyle(edge, spec, route) {
  const dashed = edge.kind === "return" ? "dashed=1;" : "";
  const startArrow = edge.kind === "bidirectional" ? "classic" : "none";
  const endArrow = edge.kind === "association" ? "none" : "classic";
  const stroke = color(edge.style?.strokeColor, spec.theme.stroke);
  const font = color(edge.style?.textColor, spec.theme.text);
  const background = color(edge.style?.labelBackgroundColor, spec.theme.background);
  const fontSize = number(edge.style?.fontSize ?? DEFAULT_FONT_SIZES.edge);
  const ports = route
    ? `exitX=${number(route.startFixedPoint[0])};exitY=${number(route.startFixedPoint[1])};exitDx=0;exitDy=0;entryX=${number(route.endFixedPoint[0])};entryY=${number(route.endFixedPoint[1])};entryDx=0;entryDy=0;`
    : "";
  return `edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=0;${ports}${dashed}startArrow=${startArrow};endArrow=${endArrow};strokeColor=${stroke};fontColor=${font};labelBackgroundColor=${background};fontSize=${fontSize};`;
}

function annotationStyle(annotation, spec) {
  const font = color(annotation.style?.textColor, spec.theme.text);
  const fontSize = number(annotation.style?.fontSize ?? DEFAULT_FONT_SIZES.annotation);
  return `text;html=0;strokeColor=none;fillColor=none;align=left;verticalAlign=top;whiteSpace=wrap;fontColor=${font};fontSize=${fontSize};`;
}

function color(value, fallback) {
  const candidate = String(value ?? fallback ?? "#000000");
  return /^#[0-9a-f]{6}$/iu.test(candidate) ? candidate : "#000000";
}

function number(value) {
  return String(round(Number(value)));
}

function xml(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/gu, " ")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}
