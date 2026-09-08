const entries = [
  {
    type: "flowchart",
    title: "流程图 / Flowchart",
    summary: "表达有先后关系的步骤、判断、分支和结果。",
    include: ["开始与结束", "处理步骤", "判断条件", "分支流向"],
    signals: {
      zh: ["流程图", "工作流", "处理流程", "审批流程", "操作步骤", "判断分支"],
      en: ["flowchart", "process diagram", "workflow", "approval process", "process steps", "decision branch"],
    },
  },
  {
    type: "architecture",
    title: "架构图 / Architecture Diagram",
    summary: "展示系统边界、组件、服务及其分层关系。",
    include: ["系统边界", "组件或服务", "技术分层", "组件关系"],
    signals: {
      zh: ["架构图", "系统架构", "软件架构", "微服务", "系统组件", "服务边界", "技术分层"],
      en: ["architecture diagram", "system architecture", "software architecture", "microservices", "system components", "service boundaries", "technical layers"],
    },
  },
  {
    type: "sequence",
    title: "时序图 / Sequence Diagram",
    summary: "按时间顺序表达参与者之间的消息和调用。",
    include: ["参与者", "生命线", "有序消息", "请求与响应"],
    signals: {
      zh: ["时序图", "序列图", "参与者交互", "消息顺序", "请求响应", "调用时序"],
      en: ["sequence diagram", "participant interaction", "message order", "request response", "call sequence", "lifelines"],
    },
  },
  {
    type: "er",
    title: "实体关系图 / ER Diagram",
    summary: "描述数据实体、属性、关系和基数。",
    include: ["实体", "属性", "实体关系", "基数"],
    signals: {
      zh: ["ER 图", "实体关系图", "数据模型", "数据库表", "实体关系", "一对多", "关系基数"],
      en: ["ER diagram", "entity relationship diagram", "data model", "database tables", "entity relationships", "one to many", "cardinality"],
    },
  },
  {
    type: "mindmap",
    title: "思维导图 / Mind Map",
    summary: "围绕中心主题放射式组织想法和分支。",
    include: ["中心主题", "一级分支", "子主题", "关键词"],
    signals: {
      zh: ["思维导图", "脑图", "头脑风暴", "中心主题", "主题分支", "想法发散"],
      en: ["mind map", "mindmap", "brainstorm", "central topic", "topic branches", "idea exploration"],
    },
  },
  {
    type: "class",
    title: "UML 类图 / Class Diagram",
    summary: "表达类、接口、成员及面向对象关系。",
    include: ["类或接口", "属性与方法", "继承", "聚合或组合"],
    signals: {
      zh: ["类图", "UML 类图", "类继承", "类接口", "聚合关系", "组合关系"],
      en: ["class diagram", "UML class", "class inheritance", "class interface", "aggregation relationship", "composition relationship"],
    },
  },
  {
    type: "state",
    title: "状态图 / State Diagram",
    summary: "描述对象的状态、事件和条件转换。",
    include: ["初始状态", "业务状态", "转换条件", "结束状态"],
    signals: {
      zh: ["状态图", "状态机", "状态转换", "对象生命周期", "事件驱动状态", "初始状态"],
      en: ["state diagram", "state machine", "state transition", "object lifecycle", "event driven states", "initial state"],
    },
  },
  {
    type: "swimlane",
    title: "泳道图 / Swimlane Diagram",
    summary: "按角色或部门划分职责并展示跨泳道流程。",
    include: ["角色或部门泳道", "泳道内步骤", "责任归属", "跨泳道交接"],
    signals: {
      zh: ["泳道图", "跨部门流程", "跨角色流程", "角色职责", "部门协作", "责任交接"],
      en: ["swimlane diagram", "cross functional process", "cross role process", "role responsibilities", "department collaboration", "responsibility handoff"],
    },
  },
  {
    type: "orgchart",
    title: "组织架构图 / Organization Chart",
    summary: "展示岗位、团队和上下级汇报关系。",
    include: ["组织或团队", "岗位", "上下级关系", "汇报线"],
    signals: {
      zh: ["组织架构图", "组织结构图", "部门层级", "岗位层级", "汇报关系", "上下级"],
      en: ["organization chart", "org chart", "department hierarchy", "role hierarchy", "reporting lines", "manager reports"],
    },
  },
  {
    type: "gantt",
    title: "甘特图 / Gantt Chart",
    summary: "沿时间轴安排项目任务、工期、依赖和里程碑。",
    include: ["任务", "开始与结束时间", "工期", "依赖与里程碑"],
    signals: {
      zh: ["甘特图", "项目排期", "任务工期", "任务依赖", "项目进度", "里程碑"],
      en: ["Gantt chart", "project schedule", "task duration", "task dependencies", "project progress", "milestones"],
    },
  },
  {
    type: "timeline",
    title: "时间线 / Timeline",
    summary: "按时间先后排列事件、阶段或历史节点。",
    include: ["时间点", "事件", "阶段", "关键节点"],
    signals: {
      zh: ["时间线", "大事记", "事件顺序", "历史沿革", "发展历程", "时间节点"],
      en: ["timeline", "chronology", "event order", "historical events", "evolution history", "points in time"],
    },
  },
  {
    type: "tree",
    title: "树形图 / Tree Diagram",
    summary: "用父子层级表达分类、分解或路径。",
    include: ["根节点", "父子节点", "层级", "叶节点"],
    signals: {
      zh: ["树形图", "树状图", "父子层级", "分类层级", "目录结构", "决策树"],
      en: ["tree diagram", "tree structure", "parent child hierarchy", "classification hierarchy", "directory structure", "decision tree"],
    },
  },
  {
    type: "network",
    title: "网络拓扑图 / Network Diagram",
    summary: "展示网络设备、链路、区域和连接拓扑。",
    include: ["网络设备", "网络区域", "链路", "地址或协议注释"],
    signals: {
      zh: ["网络拓扑图", "网络图", "路由器", "交换机", "子网", "网络链路"],
      en: ["network topology diagram", "network diagram", "routers", "switches", "subnets", "network links"],
    },
  },
  {
    type: "dataflow",
    title: "数据流图 / Data Flow Diagram",
    summary: "追踪数据从来源经处理到存储或去向的流动。",
    include: ["数据源", "处理或转换", "数据存储", "数据去向"],
    signals: {
      zh: ["数据流图", "数据流", "数据管道", "数据源", "数据转换", "数据去向", "ETL 流程"],
      en: ["data flow diagram", "dataflow diagram", "data flow", "data pipeline", "data sources", "data transformations", "data sinks", "ETL pipeline"],
    },
  },
  {
    type: "concept",
    title: "概念图 / Concept Map",
    summary: "用带语义的关系连接概念并表达交叉关联。",
    include: ["核心概念", "相关概念", "关系标签", "交叉连接"],
    signals: {
      zh: ["概念图", "概念关系", "知识概念", "语义关系", "交叉连接"],
      en: ["concept map", "concept relationships", "knowledge concepts", "semantic relationships", "cross links"],
    },
  },
  {
    type: "fishbone",
    title: "鱼骨图 / Fishbone Diagram",
    summary: "围绕问题结果分类梳理潜在原因。",
    include: ["问题或结果", "原因类别", "主因", "次级原因"],
    signals: {
      zh: ["鱼骨图", "因果图", "根因分析", "原因分类", "问题原因"],
      en: ["fishbone diagram", "cause effect diagram", "root cause analysis", "cause categories", "problem causes"],
    },
  },
  {
    type: "swot",
    title: "SWOT 分析图 / SWOT Diagram",
    summary: "从优势、劣势、机会和威胁四个象限分析主题。",
    include: ["优势", "劣势", "机会", "威胁"],
    signals: {
      zh: ["SWOT 分析", "优势劣势", "机会威胁", "战略四象限"],
      en: ["SWOT analysis", "strengths weaknesses", "opportunities threats", "strategy quadrants"],
    },
  },
  {
    type: "pyramid",
    title: "金字塔图 / Pyramid Diagram",
    summary: "用逐层收窄的结构表达等级、优先级或构成。",
    include: ["底层基础", "中间层级", "顶层目标", "层级标签"],
    signals: {
      zh: ["金字塔图", "层级金字塔", "逐层递进", "优先级层次"],
      en: ["pyramid diagram", "hierarchy pyramid", "progressive levels", "priority levels"],
    },
  },
  {
    type: "funnel",
    title: "漏斗图 / Funnel Diagram",
    summary: "展示对象经过连续阶段后的筛选、流失或转化。",
    include: ["漏斗阶段", "阶段输入", "筛选或流失", "最终转化"],
    signals: {
      zh: ["漏斗图", "转化漏斗", "销售漏斗", "用户流失", "阶段筛选"],
      en: ["funnel diagram", "conversion funnel", "sales funnel", "user drop off", "stage filtering"],
    },
  },
  {
    type: "venn",
    title: "韦恩图 / Venn Diagram",
    summary: "用重叠区域比较集合的共有和独有部分。",
    include: ["集合", "重叠区域", "共有项", "独有项"],
    signals: {
      zh: ["韦恩图", "集合交集", "共同点", "重叠关系", "异同比较"],
      en: ["Venn diagram", "set intersection", "common traits", "overlapping sets", "similarities differences"],
    },
  },
  {
    type: "matrix",
    title: "矩阵图 / Matrix Diagram",
    summary: "按两个维度的行列或象限比较和定位对象。",
    include: ["横向维度", "纵向维度", "单元格或象限", "比较对象"],
    signals: {
      zh: ["矩阵图", "二维矩阵", "四象限", "行列对比", "两个维度"],
      en: ["matrix diagram", "two dimensional matrix", "four quadrants", "row column comparison", "two dimensions"],
    },
  },
  {
    type: "infographic",
    title: "信息图 / Infographic",
    summary: "将关键事实、指标和短说明组织成易读的视觉摘要。",
    include: ["主题", "关键事实", "指标", "简短说明"],
    signals: {
      zh: ["信息图", "信息摘要", "数据故事", "关键指标展示", "视觉摘要"],
      en: ["infographic", "information summary", "data story", "key metrics display", "visual summary"],
    },
  },
];

function freezeEntry(entry) {
  return Object.freeze({
    ...entry,
    include: Object.freeze([...entry.include]),
    signals: Object.freeze({
      zh: Object.freeze([...entry.signals.zh]),
      en: Object.freeze([...entry.signals.en]),
    }),
  });
}

export const CHART_TYPE_GUIDE = Object.freeze(entries.map(freezeEntry));

const explicitSignalPattern = /(?:diagram|chart|flowchart|map)$/u;

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function containsSignal(query, signal) {
  const normalizedSignal = normalize(signal);
  if (normalizedSignal.length === 0) return false;
  if (/\p{Script=Han}/u.test(normalizedSignal)) return query.includes(normalizedSignal);
  return ` ${query} `.includes(` ${normalizedSignal} `);
}

function isExplicitSignal(signal) {
  const normalized = normalize(signal);
  return explicitSignalPattern.test(normalized) || /(?:图|图表)$/u.test(normalized);
}

function recommendation(entry) {
  return {
    type: entry.type,
    title: entry.title,
    summary: entry.summary,
    include: [...entry.include],
  };
}

function result(entry, confidence, matchedSignals, alternatives) {
  return {
    recommendation: recommendation(entry),
    confidence,
    matchedSignals: [...matchedSignals],
    alternatives: alternatives.map(({ entry: alternative }) => recommendation(alternative)),
  };
}

export function recommendChartType(query) {
  const normalizedQuery = normalize(query);
  const exactIndex = CHART_TYPE_GUIDE.findIndex((entry) => normalizedQuery === entry.type);

  if (exactIndex !== -1) {
    return result(CHART_TYPE_GUIDE[exactIndex], "high", [CHART_TYPE_GUIDE[exactIndex].type], []);
  }

  const ranked = CHART_TYPE_GUIDE.map((entry, index) => {
    const signals = [...entry.signals.zh, ...entry.signals.en];
    const matchedSignals = signals.filter((signal) => containsSignal(normalizedQuery, signal));
    const score = matchedSignals.reduce(
      (total, signal) => total + (isExplicitSignal(signal) ? 3 : 1),
      0,
    );
    return { entry, index, matchedSignals, score };
  }).sort((left, right) => right.score - left.score || left.index - right.index);

  if (ranked[0].score === 0) {
    return result(CHART_TYPE_GUIDE[0], "low", [], []);
  }

  const winner = ranked[0];
  const confidence = winner.matchedSignals.some(isExplicitSignal)
    || winner.matchedSignals.length > 1
    ? "high"
    : "medium";
  const alternatives = ranked.filter((candidate) => candidate.score > 0).slice(1, 3);
  return result(winner.entry, confidence, winner.matchedSignals, alternatives);
}
