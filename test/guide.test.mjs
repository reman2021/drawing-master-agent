import assert from "node:assert/strict";
import test from "node:test";

import { CHART_TYPES } from "../runtime/lib/core.mjs";
import { CHART_TYPE_GUIDE, recommendChartType } from "../runtime/lib/guide.mjs";

test("guide covers every chart type with Chinese and English signals", () => {
  assert.deepEqual(new Set(CHART_TYPE_GUIDE.map(({ type }) => type)), CHART_TYPES);
  assert.equal(CHART_TYPE_GUIDE.length, 22);
  for (const entry of CHART_TYPE_GUIDE) {
    assert.ok(entry.signals.zh.length > 0, `${entry.type} needs Chinese signals`);
    assert.ok(entry.signals.en.length > 0, `${entry.type} needs English signals`);
  }
});

test("exact type names produce high-confidence recommendations", () => {
  for (const type of CHART_TYPES) {
    const result = recommendChartType(type);
    assert.equal(result.recommendation.type, type);
    assert.equal(result.confidence, "high");
    assert.deepEqual(result.matchedSignals, [type]);
  }
});

const representativeQueries = [
  ["architecture", "Show system components, service boundaries, and technical layers"],
  ["architecture", "展示系统组件、服务边界和技术分层"],
  ["flowchart", "Show workflow steps and decision branches for approval"],
  ["flowchart", "画出审批流程的操作步骤和判断分支"],
  ["sequence", "Show participant interaction, request response, and message order"],
  ["sequence", "展示参与者交互中的请求响应和消息顺序"],
  ["dataflow", "Trace data sources, data transformations, and data sinks in an ETL pipeline"],
  ["dataflow", "追踪 ETL 流程中的数据源、数据转换和数据去向"],
  ["state", "Model the object lifecycle and state transitions triggered by events"],
  ["state", "描述对象生命周期中的状态转换"],
  ["swimlane", "Map role responsibilities and responsibility handoffs across departments"],
  ["swimlane", "展示跨部门流程中的角色职责和责任交接"],
  ["er", "Model database tables, entity relationships, and cardinality"],
  ["er", "描述数据库表、实体关系和关系基数"],
  ["mindmap", "Brainstorm topic branches around a central topic"],
  ["mindmap", "围绕中心主题做头脑风暴并展开主题分支"],
  ["class", "Show UML class inheritance and composition relationships"],
  ["class", "展示 UML 类图中的类继承和组合关系"],
  ["gantt", "Plan a project schedule with task duration, dependencies, and milestones"],
  ["gantt", "制定包含任务工期、任务依赖和里程碑的项目排期"],
];

for (const [type, query] of representativeQueries) {
  test(`recommends ${type} for ${query}`, () => {
    const result = recommendChartType(query);
    assert.equal(result.recommendation.type, type);
    assert.notEqual(result.confidence, "low");
    assert.ok(result.matchedSignals.length > 0);
  });
}

test("unknown text honestly falls back to flowchart with low confidence", () => {
  assert.deepEqual(recommendChartType("Please make this clearer and nicer"), {
    recommendation: {
      type: "flowchart",
      title: "流程图 / Flowchart",
      summary: "表达有先后关系的步骤、判断、分支和结果。",
      include: ["开始与结束", "处理步骤", "判断条件", "分支流向"],
    },
    confidence: "low",
    matchedSignals: [],
    alternatives: [],
  });
});

test("signal order and returned values are deterministic", () => {
  const first = recommendChartType("system components service boundaries technical layers");
  const reordered = recommendChartType("technical layers system components service boundaries");
  assert.deepEqual(first, reordered);
  assert.deepEqual(first, recommendChartType("system components service boundaries technical layers"));

  first.recommendation.include.push("caller mutation");
  assert.doesNotMatch(JSON.stringify(recommendChartType("architecture")), /caller mutation/u);
});
