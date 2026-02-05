import { createAdapterFactory as ne } from "@better-auth/core/db/adapter";
import { randomUUID as Be } from "node:crypto";
import { QueryCommand as ve, ScanCommand as Se, BatchGetCommand as Ge, TransactWriteCommand as Ue, PutCommand as He, DeleteCommand as We, UpdateCommand as Qe } from "@aws-sdk/lib-dynamodb";
import { CreateTableCommand as Je, waitUntilTableExists as ze, ListTablesCommand as Ye, DescribeTableCommand as Xe, UpdateTableCommand as Ae } from "@aws-sdk/client-dynamodb";
class b extends Error {
  constructor(t, n) {
    super(n), this.code = t, this.name = "DynamoDBAdapterError";
  }
}
const Ce = (e) => e ? e.toLowerCase() : "eq", ie = (e) => typeof e == "number" && !Number.isNaN(e), k = (e) => typeof e == "string", Ze = (e, t) => e instanceof Date && t instanceof Date ? e.getTime() - t.getTime() : ie(e) && ie(t) ? e - t : k(e) && k(t) ? e < t ? -1 : e > t ? 1 : 0 : null, Te = (e) => Array.isArray(e) ? e : [e], O = (e) => {
  const t = e.appendValue(e.value);
  return `${e.fieldToken} ${e.operator} ${t}`;
}, V = (e) => {
  const t = Ze(e.fieldValue, e.value);
  return t === null ? !1 : e.operator === "gt" ? t > 0 : e.operator === "gte" ? t >= 0 : e.operator === "lt" ? t < 0 : t <= 0;
}, ae = (e) => {
  const n = Te(e.value).map(
    (a) => e.appendValue(a)
  ), i = `${e.fieldToken} IN (${n.join(", ")})`;
  return e.negate ? `NOT (${i})` : i;
}, re = (e) => {
  const n = Te(e.value).some((i) => i === e.fieldValue);
  return e.negate ? !n : n;
}, et = (e) => {
  const t = e.appendValue(e.value);
  return `contains(${e.fieldToken}, ${t})`;
}, tt = (e) => Array.isArray(e.fieldValue) || k(e.fieldValue) && k(e.value) ? e.fieldValue.includes(e.value) : !1, nt = (e) => {
  const t = e.appendValue(e.value);
  return `begins_with(${e.fieldToken}, ${t})`;
}, it = (e) => k(e.fieldValue) && k(e.value) ? e.fieldValue.startsWith(e.value) : !1, at = (e) => k(e.fieldValue) && k(e.value) ? e.fieldValue.endsWith(e.value) : !1, rt = {
  eq: {
    requiresClientFilter: !1,
    buildFilterExpression: (e) => {
      const t = e.appendValue(e.value);
      return `${e.fieldToken} = ${t}`;
    },
    evaluate: (e) => e.fieldValue === e.value
  },
  ne: {
    requiresClientFilter: !1,
    buildFilterExpression: (e) => {
      const t = e.appendValue(e.value);
      return `${e.fieldToken} <> ${t}`;
    },
    evaluate: (e) => e.fieldValue !== e.value
  },
  gt: {
    requiresClientFilter: !1,
    buildFilterExpression: (e) => O({
      fieldToken: e.fieldToken,
      value: e.value,
      operator: ">",
      appendValue: e.appendValue
    }),
    evaluate: (e) => V({
      fieldValue: e.fieldValue,
      value: e.value,
      operator: "gt"
    })
  },
  gte: {
    requiresClientFilter: !1,
    buildFilterExpression: (e) => O({
      fieldToken: e.fieldToken,
      value: e.value,
      operator: ">=",
      appendValue: e.appendValue
    }),
    evaluate: (e) => V({
      fieldValue: e.fieldValue,
      value: e.value,
      operator: "gte"
    })
  },
  lt: {
    requiresClientFilter: !1,
    buildFilterExpression: (e) => O({
      fieldToken: e.fieldToken,
      value: e.value,
      operator: "<",
      appendValue: e.appendValue
    }),
    evaluate: (e) => V({
      fieldValue: e.fieldValue,
      value: e.value,
      operator: "lt"
    })
  },
  lte: {
    requiresClientFilter: !1,
    buildFilterExpression: (e) => O({
      fieldToken: e.fieldToken,
      value: e.value,
      operator: "<=",
      appendValue: e.appendValue
    }),
    evaluate: (e) => V({
      fieldValue: e.fieldValue,
      value: e.value,
      operator: "lte"
    })
  },
  in: {
    requiresClientFilter: !1,
    buildFilterExpression: (e) => ae({
      fieldToken: e.fieldToken,
      value: e.value,
      appendValue: e.appendValue,
      negate: !1
    }),
    evaluate: (e) => re({
      fieldValue: e.fieldValue,
      value: e.value,
      negate: !1
    })
  },
  not_in: {
    requiresClientFilter: !1,
    buildFilterExpression: (e) => ae({
      fieldToken: e.fieldToken,
      value: e.value,
      appendValue: e.appendValue,
      negate: !0
    }),
    evaluate: (e) => re({
      fieldValue: e.fieldValue,
      value: e.value,
      negate: !0
    })
  },
  contains: {
    requiresClientFilter: !1,
    buildFilterExpression: et,
    evaluate: tt
  },
  starts_with: {
    requiresClientFilter: !1,
    buildFilterExpression: nt,
    evaluate: it
  },
  ends_with: {
    requiresClientFilter: !0,
    buildFilterExpression: void 0,
    evaluate: at
  }
}, J = (e) => {
  const t = Ce(e), n = rt[t];
  if (!n)
    throw new b(
      "UNSUPPORTED_OPERATOR",
      `Unsupported operator: ${e}`
    );
  return n;
}, Ie = (e) => J(e).requiresClientFilter, z = (e) => Ce(e), we = (e) => {
  if (!e)
    throw new b(
      "MISSING_WHERE_INPUT",
      "normalizeWhere requires explicit props."
    );
  const { where: t } = e;
  if (!t || t.length === 0)
    return [];
  const n = (i) => i && i.toUpperCase() === "OR" ? "OR" : "AND";
  return t.map((i) => {
    const a = z(
      i.operator
    ), r = n(i.connector);
    return {
      field: i.field,
      operator: a,
      value: i.value,
      connector: r,
      requiresClientFilter: Ie(i.operator)
    };
  });
}, Ee = (e) => e.getFieldName({ model: e.model, field: "id" }), se = (e) => e.where.find(
  (t) => t.operator === e.operator && t.field === e.primaryKeyName
), st = (e) => {
  const t = (r) => r ? e.where.some(
    (s) => s.operator === "eq" && s.field === r
  ) : !1, n = (r) => {
    if (e.indexKeySchemaResolver)
      return e.indexKeySchemaResolver({ model: e.model, indexName: r });
  }, a = e.where.filter((r) => r.operator === "eq").map((r) => {
    const s = e.indexNameResolver({
      model: e.model,
      field: r.field
    });
    if (!s)
      return null;
    const l = n(s)?.sortKey, m = t(l);
    return {
      entry: r,
      indexName: s,
      score: m ? 2 : 1
    };
  }).filter((r) => r !== null).reduce((r, s) => !r || s.score > r.score ? s : r, void 0);
  if (a)
    return { entry: a.entry, indexName: a.indexName };
}, ot = (e) => {
  for (const t of e.where) {
    if (t.operator !== "in" || !Array.isArray(t.value))
      continue;
    const n = e.indexNameResolver({
      model: e.model,
      field: t.field
    });
    if (n)
      return { entry: t, indexName: n };
  }
}, lt = (e) => {
  if (!e)
    throw new b(
      "MISSING_STRATEGY_INPUT",
      "resolveBaseStrategy requires explicit props."
    );
  const t = e.where.filter((o) => o.connector === "AND"), n = Ee({
    model: e.model,
    getFieldName: e.getFieldName
  });
  if (se({
    where: t,
    primaryKeyName: n,
    operator: "eq"
  }))
    return { kind: "query", key: "pk" };
  const a = st({
    where: t,
    model: e.model,
    indexNameResolver: e.adapterConfig.indexNameResolver,
    indexKeySchemaResolver: e.adapterConfig.indexKeySchemaResolver
  });
  if (a)
    return { kind: "query", key: "gsi", indexName: a.indexName };
  const r = ot({
    where: t,
    model: e.model,
    indexNameResolver: e.adapterConfig.indexNameResolver
  });
  if (r)
    return {
      kind: "multi-query",
      indexName: r.indexName,
      field: r.entry.field
    };
  const s = se({
    where: t,
    primaryKeyName: n,
    operator: "in"
  });
  return s && Array.isArray(s.value) ? { kind: "batch-get" } : { kind: "scan" };
}, ke = (e) => {
  if (!e)
    throw new b(
      "MISSING_JOIN_STRATEGY_INPUT",
      "resolveJoinStrategyHint requires explicit props."
    );
  const t = Ee({
    model: e.model,
    getFieldName: e.getFieldName
  });
  if (e.joinField === t)
    return { kind: "query", key: "pk" };
  const n = e.adapterConfig.indexNameResolver({
    model: e.model,
    field: e.joinField
  });
  return n ? { kind: "query", key: "gsi", indexName: n } : { kind: "scan" };
}, ut = (e) => {
  if (!e)
    throw new b(
      "MISSING_JOIN_STRATEGY_INPUT",
      "resolveJoinStrategy requires explicit props."
    );
  const t = ke({
    joinField: e.joinField,
    model: e.model,
    getFieldName: e.getFieldName,
    adapterConfig: e.adapterConfig
  });
  return t.kind === "query" && t.key === "pk" && e.baseValues.length > 1 ? { kind: "batch-get" } : t;
}, dt = (e) => {
  if (!e)
    throw new b(
      "MISSING_JOIN_PLAN_INPUT",
      "resolveJoinPlan requires explicit props."
    );
  return !e.join || Object.keys(e.join).length === 0 ? [] : Object.entries(e.join).map(([t, n]) => {
    const i = ke({
      joinField: n.on.to,
      model: t,
      getFieldName: e.getFieldName,
      adapterConfig: e.adapterConfig
    });
    return {
      modelKey: t,
      model: t,
      relation: n.relation ?? "one-to-many",
      on: n.on,
      limit: n.limit,
      select: void 0,
      strategy: i
    };
  });
}, ct = (e) => {
  const t = e.where.some(
    (i) => i.connector === "OR"
  ), n = e.where.some(
    (i) => i.requiresClientFilter
  );
  return {
    hasOrConnector: t,
    hasClientOnlyOperator: n,
    requiresSelectSupplement: e.requiresSelectSupplement
  };
}, mt = (e) => {
  if (e.requiresClientFilter || e.requiresClientSort || e.limit === void 0)
    return;
  const t = e.offset ?? 0;
  return e.limit + t;
}, ft = (e) => {
  if (e.sortBy)
    return {
      field: e.getFieldName({ model: e.model, field: e.sortBy.field }),
      direction: e.sortBy.direction
    };
}, yt = (e) => {
  if (!e.normalizedSort || e.baseStrategy.kind !== "query" || e.baseStrategy.key !== "gsi" || !e.baseStrategy.indexName || !e.adapterConfig.indexKeySchemaResolver)
    return;
  const t = e.adapterConfig.indexKeySchemaResolver({
    model: e.model,
    indexName: e.baseStrategy.indexName
  });
  if (!(!t || !t.sortKey) && t.sortKey === e.normalizedSort.field)
    return e.normalizedSort;
}, bt = (e) => !(!e.normalizedSort || e.serverSort), Nt = (e) => {
  if (!e.select || e.select.length === 0)
    return { select: e.select, requiresSelectSupplement: !1 };
  if (e.joins.length === 0)
    return { select: [...e.select], requiresSelectSupplement: !1 };
  const t = {
    select: [...e.select],
    selectedFields: new Set(
      e.select.map(
        (i) => e.getFieldName({ model: e.model, field: i })
      )
    ),
    requiresSelectSupplement: !1
  }, n = e.joins.reduce((i, a) => i.selectedFields.has(a.on.from) ? i : (i.selectedFields.add(a.on.from), i.select.push(a.on.from), {
    ...i,
    requiresSelectSupplement: !0
  }), t);
  return {
    select: n.select,
    requiresSelectSupplement: n.requiresSelectSupplement
  };
}, K = (e) => {
  if (!e)
    throw new b(
      "MISSING_QUERY_PLAN_INPUT",
      "buildQueryPlan requires explicit props."
    );
  const t = we({ where: e.where }), n = dt({
    join: e.join,
    getFieldName: e.getFieldName,
    adapterConfig: e.adapterConfig
  }), i = Nt({
    select: e.select,
    joins: n,
    getFieldName: e.getFieldName,
    model: e.model
  }), a = ct({
    where: t,
    requiresSelectSupplement: i.requiresSelectSupplement
  }), r = lt({
    model: e.model,
    where: t,
    getFieldName: e.getFieldName,
    adapterConfig: e.adapterConfig
  }), s = n.reduce(
    (c, f) => (c[f.modelKey] = f.strategy, c),
    {}
  ), o = a.hasClientOnlyOperator, l = ft({
    sortBy: e.sortBy,
    getFieldName: e.getFieldName,
    model: e.model
  }), m = yt({
    model: e.model,
    baseStrategy: r,
    normalizedSort: l,
    adapterConfig: e.adapterConfig
  }), d = bt({
    normalizedSort: l,
    serverSort: m
  }), u = {
    baseStrategy: r,
    joinStrategies: s,
    requiresClientFilter: o,
    requiresClientSort: d,
    serverSort: m,
    fetchLimit: mt({
      limit: e.limit,
      offset: e.offset,
      requiresClientFilter: o,
      requiresClientSort: d
    })
  };
  return {
    base: {
      model: e.model,
      where: t,
      select: i.select,
      sort: l,
      limit: e.limit,
      offset: e.offset
    },
    joins: n,
    execution: u,
    constraints: a
  };
}, oe = (e) => {
  const t = J(e.condition.operator), n = e.item[e.condition.fieldName];
  return t.evaluate({ fieldValue: n, value: e.condition.value });
}, xt = (e) => e.map((t) => ({
  fieldName: t.field,
  operator: z(t.operator),
  value: t.value,
  connector: t.connector
})), gt = (e) => {
  const { item: t, conditions: n } = e;
  if (n.length === 0)
    return !0;
  const i = n.filter(
    (u) => u.connector === "AND"
  ), a = n.filter(
    (u) => u.connector === "OR"
  ), r = i.map(
    (u) => oe({ item: t, condition: u })
  ), s = a.map(
    (u) => oe({ item: t, condition: u })
  ), o = (u) => u.length === 0 ? !0 : u.every(Boolean), l = (u) => u.length === 0 ? !0 : u.some(Boolean);
  return !(!o(r) || !l(s));
}, pe = (e) => {
  if (!e.where || e.where.length === 0)
    return e.items;
  const t = xt(e.where);
  return e.items.filter((n) => gt({ item: n, conditions: t }));
}, ht = (e) => e.requiresClientFilter ? pe({ items: e.items, where: e.where }) : e.items, vt = (e) => e === "desc" ? -1 : 1, St = (e, t) => {
  if (e.length <= 1)
    return e;
  const n = vt(t.direction), i = (a) => a == null;
  return [...e].sort((a, r) => {
    const s = a[t.field], o = r[t.field];
    return s === o ? 0 : i(s) ? 1 * n : i(o) ? -1 * n : s > o ? 1 * n : s < o ? -1 * n : 0;
  });
}, At = (e, t) => t.sortBy ? St(e, {
  field: t.sortBy.field,
  direction: t.sortBy.direction
}) : e, Ct = (e) => {
  if (!e.select || e.select.length === 0)
    return e.items;
  const t = e.select.map(
    (n) => e.getFieldName({ model: e.model, field: n })
  );
  return e.items.map((n) => {
    const i = t.reduce(
      (r, s) => (s in n && (r[s] = n[s]), r),
      {}
    ), a = e.joinKeys.reduce(
      (r, s) => (s in n && (r[s] = n[s]), r),
      {}
    );
    return { ...i, ...a };
  });
}, T = (e) => {
  const { model: t, getDefaultModelName: n, config: i } = e, a = n(t);
  if (i.tableNameResolver)
    return i.tableNameResolver(a);
  if (i.tableNamePrefix !== void 0)
    return `${i.tableNamePrefix}${a}`;
  throw new b(
    "MISSING_TABLE_RESOLVER",
    "DynamoDB adapter requires tableNameResolver or tableNamePrefix."
  );
}, Tt = (e, t, n) => {
  const i = `:v${t.index}`;
  return t.index += 1, n[i] = e, i;
}, It = (e) => e && e.toUpperCase() === "OR" ? "OR" : "AND", wt = (e) => {
  for (const t of e)
    if (Ie(t.operator))
      return !0;
  return !1;
}, Et = (e) => {
  const t = J(e.operator);
  if (!t.buildFilterExpression)
    throw new b(
      "UNSUPPORTED_OPERATOR",
      "Filter expression builder is missing."
    );
  const n = {
    fieldToken: e.fieldToken,
    value: e.value,
    appendValue: (i) => Tt(i, e.state, e.values)
  };
  return t.buildFilterExpression(n);
}, kt = (e) => {
  const { andExpressions: t, orExpressions: n } = e, i = t.join(" AND "), a = n.join(" OR ");
  if (i && a)
    return `(${i}) AND (${a})`;
  if (i)
    return i;
  if (a)
    return a;
}, p = (e) => {
  const { where: t, model: n, getFieldName: i } = e;
  if (!t || t.length === 0)
    return {
      filterExpression: void 0,
      expressionAttributeNames: {},
      expressionAttributeValues: {},
      requiresClientFilter: !1
    };
  if (wt(t))
    return {
      filterExpression: void 0,
      expressionAttributeNames: {},
      expressionAttributeValues: {},
      requiresClientFilter: !0
    };
  const a = {}, r = {}, s = { index: 0 }, o = t.map((u, c) => {
    const f = i({ model: n, field: u.field }), N = `#f${c}`;
    a[N] = f;
    const x = Et({
      fieldToken: N,
      operator: u.operator,
      value: u.value,
      state: s,
      values: r
    });
    return {
      connector: It(u.connector),
      expression: x
    };
  }), l = o.filter((u) => u.connector === "AND").map((u) => u.expression), m = o.filter((u) => u.connector === "OR").map((u) => u.expression);
  return {
    filterExpression: kt({
      andExpressions: l,
      orExpressions: m
    }),
    expressionAttributeNames: a,
    expressionAttributeValues: r,
    requiresClientFilter: !1
  };
}, _ = (e) => {
  const { model: t, where: n, getFieldName: i, indexNameResolver: a, indexKeySchemaResolver: r } = e;
  if (!n || n.length === 0)
    return null;
  const s = i({ model: t, field: "id" }), o = (y) => y && y.toUpperCase() === "OR" ? "OR" : "AND", l = n.map((y) => ({
    entry: y,
    operator: z(y.operator),
    fieldName: i({ model: t, field: y.field }),
    connector: o(y.connector)
  })), m = l.find(
    ({ operator: y, fieldName: S, connector: E }) => y === "eq" && E === "AND" && S === s
  );
  if (m) {
    const y = n.filter(
      (S) => S !== m.entry
    );
    return {
      keyConditionExpression: "#pk = :pk",
      expressionAttributeNames: { "#pk": s },
      expressionAttributeValues: {
        ":pk": m.entry.value
      },
      remainingWhere: y
    };
  }
  const d = (y) => y ? l.some((S) => S.connector !== "AND" || S.operator !== "eq" ? !1 : S.fieldName === y) : !1, u = (y) => {
    if (r)
      return r({ model: t, indexName: y });
  }, c = l.filter((y) => y.connector !== "AND" || y.operator !== "eq" ? !1 : !!a({ model: t, field: y.entry.field })).map((y) => {
    const S = a({ model: t, field: y.entry.field });
    if (!S)
      return null;
    const L = u(S)?.sortKey, je = d(L);
    return {
      candidate: y,
      indexName: S,
      score: je ? 2 : 1
    };
  }).filter((y) => y !== null), N = c.reduce((S, E) => !S || E.score > S.score ? E : S, void 0);
  if (!N)
    return null;
  const x = N.indexName, v = N.candidate, A = () => {
    if (r)
      return r({ model: t, indexName: x });
  }, h = (y) => {
    if (y)
      return l.find(
        ({ operator: S, fieldName: E, connector: L }) => S === "eq" && L === "AND" && E === y
      );
  }, g = (y) => y ? "#pk = :pk AND #sk = :sk" : "#pk = :pk", C = (y) => y.sortKey ? {
    "#pk": y.partitionKey,
    "#sk": y.sortKey
  } : { "#pk": y.partitionKey }, w = (y) => y.sortValue === void 0 ? { ":pk": y.partitionValue } : {
    ":pk": y.partitionValue,
    ":sk": y.sortValue
  }, M = A()?.sortKey, D = h(M), F = (y) => {
    if (y)
      return M;
  }, $e = (y) => {
    if (y)
      return y.entry.value;
  }, _e = n.filter(
    (y) => y !== v.entry && y !== D?.entry
  ), Re = g(
    !!D
  ), qe = C({
    partitionKey: v.fieldName,
    sortKey: F(D)
  }), Le = w({
    partitionValue: v.entry.value,
    sortValue: $e(D)
  });
  return {
    keyConditionExpression: Re,
    expressionAttributeNames: qe,
    expressionAttributeValues: Le,
    indexName: x,
    remainingWhere: _e
  };
}, R = (e, t) => {
  t.filterExpression && (e.FilterExpression = t.filterExpression), Object.keys(t.expressionAttributeNames).length > 0 && (e.ExpressionAttributeNames = t.expressionAttributeNames), Object.keys(t.expressionAttributeValues).length > 0 && (e.ExpressionAttributeValues = t.expressionAttributeValues);
}, q = async (e) => {
  const t = {
    token: e.initialToken,
    pageCount: 0
  };
  for (; ; ) {
    e.maxPages !== void 0 && t.pageCount >= e.maxPages && e.onMaxPages(), t.pageCount += 1;
    const n = await e.fetchPage(t.token, t.pageCount), i = n.nextToken, a = n.shouldStop === !0;
    if (t.token = i, a || !t.token)
      break;
  }
}, De = (e, t) => {
  if (e === void 0)
    return;
  const n = e - t;
  return n <= 0 ? 0 : n;
}, H = async (e) => {
  const t = [], n = { pages: 0 };
  if (await q({
    fetchPage: async (i) => {
      n.pages += 1;
      const a = De(e.limit, t.length);
      if (a === 0)
        return { shouldStop: !0 };
      const r = {
        TableName: e.tableName,
        KeyConditionExpression: e.keyConditionExpression
      };
      e.indexName && (r.IndexName = e.indexName), R(r, {
        filterExpression: e.filterExpression,
        expressionAttributeNames: e.expressionAttributeNames,
        expressionAttributeValues: e.expressionAttributeValues
      }), i && (r.ExclusiveStartKey = i), a !== void 0 && (r.Limit = a), e.scanIndexForward !== void 0 && (r.ScanIndexForward = e.scanIndexForward);
      const s = await e.documentClient.send(
        new ve(r)
      ), o = s.Items ?? [];
      return t.push(...o), e.operationStats?.recordQuery({
        tableName: e.tableName,
        items: o.length
      }), { nextToken: s.LastEvaluatedKey ?? void 0 };
    }
  }), e.explainDynamoOperations) {
    const i = e.limit === void 0 ? "∞" : String(e.limit), a = e.filterExpression ? "yes" : "no", r = e.indexName ?? "(primary)";
    console.log(
      `DDB-OP QUERY table=${e.tableName} index=${r} pages=${n.pages} items=${t.length} limit=${i} filter=${a}`
    );
  }
  return t;
}, pt = async (e) => {
  const t = { count: 0 }, n = { pages: 0 };
  if (await q({
    fetchPage: async (i) => {
      n.pages += 1;
      const a = {
        TableName: e.tableName,
        KeyConditionExpression: e.keyConditionExpression,
        Select: "COUNT"
      };
      e.indexName && (a.IndexName = e.indexName), R(a, {
        filterExpression: e.filterExpression,
        expressionAttributeNames: e.expressionAttributeNames,
        expressionAttributeValues: e.expressionAttributeValues
      }), i && (a.ExclusiveStartKey = i);
      const r = await e.documentClient.send(
        new ve(a)
      ), s = r.Count ?? 0;
      return t.count += s, e.operationStats?.recordQuery({
        tableName: e.tableName,
        items: s
      }), { nextToken: r.LastEvaluatedKey ?? void 0 };
    }
  }), e.explainDynamoOperations) {
    const i = e.filterExpression ? "yes" : "no", a = e.indexName ?? "(primary)";
    console.log(
      `DDB-OP QUERY-COUNT table=${e.tableName} index=${a} pages=${n.pages} count=${t.count} filter=${i}`
    );
  }
  return t.count;
}, Pe = async (e) => {
  const t = [], n = { pages: 0 };
  if (await q({
    maxPages: e.maxPages ?? Number.POSITIVE_INFINITY,
    onMaxPages: () => {
      throw new b(
        "SCAN_PAGE_LIMIT",
        "Scan exceeded the configured page limit."
      );
    },
    fetchPage: async (i) => {
      n.pages += 1;
      const a = De(e.limit, t.length);
      if (a === 0)
        return { shouldStop: !0 };
      const r = {
        TableName: e.tableName
      };
      R(r, {
        filterExpression: e.filterExpression,
        expressionAttributeNames: e.expressionAttributeNames,
        expressionAttributeValues: e.expressionAttributeValues
      }), i && (r.ExclusiveStartKey = i), a !== void 0 && (r.Limit = a);
      const s = await e.documentClient.send(
        new Se(r)
      ), o = s.Items ?? [];
      return t.push(...o), e.operationStats?.recordScan({
        tableName: e.tableName,
        items: o.length
      }), { nextToken: s.LastEvaluatedKey ?? void 0 };
    }
  }), e.explainDynamoOperations) {
    const i = e.maxPages === void 0 ? "∞" : String(e.maxPages), a = e.limit === void 0 ? "∞" : String(e.limit), r = e.filterExpression ? "yes" : "no";
    console.log(
      `DDB-OP SCAN table=${e.tableName} pages=${n.pages} items=${t.length} limit=${a} maxPages=${i} filter=${r}`
    );
  }
  return t;
}, Dt = async (e) => {
  const t = { count: 0 }, n = { pages: 0 };
  if (await q({
    maxPages: e.maxPages ?? Number.POSITIVE_INFINITY,
    onMaxPages: () => {
      throw new b(
        "SCAN_PAGE_LIMIT",
        "Scan exceeded the configured page limit."
      );
    },
    fetchPage: async (i) => {
      n.pages += 1;
      const a = {
        TableName: e.tableName,
        Select: "COUNT"
      };
      R(a, {
        filterExpression: e.filterExpression,
        expressionAttributeNames: e.expressionAttributeNames,
        expressionAttributeValues: e.expressionAttributeValues
      }), i && (a.ExclusiveStartKey = i);
      const r = await e.documentClient.send(
        new Se(a)
      ), s = r.Count ?? 0;
      return t.count += s, e.operationStats?.recordScan({
        tableName: e.tableName,
        items: s
      }), { nextToken: r.LastEvaluatedKey ?? void 0 };
    }
  }), e.explainDynamoOperations) {
    const i = e.maxPages === void 0 ? "∞" : String(e.maxPages), a = e.filterExpression ? "yes" : "no";
    console.log(
      `DDB-OP SCAN-COUNT table=${e.tableName} pages=${n.pages} count=${t.count} maxPages=${i} filter=${a}`
    );
  }
  return t.count;
}, Pt = (e, t) => {
  const n = Math.ceil(e.length / t);
  return Array.from(
    { length: n },
    (i, a) => e.slice(a * t, (a + 1) * t)
  );
}, Mt = (e, t) => t.map((n) => ({ [e]: n })), Kt = (e) => {
  const t = e.unprocessed?.[e.tableName]?.Keys;
  return t || [];
}, Y = async (e) => {
  if (e.keys.length === 0)
    return [];
  const t = e.maxAttempts ?? 5;
  if (t <= 0)
    throw new b(
      "INVALID_BATCH_GET_ATTEMPTS",
      "BatchGet requires maxAttempts > 0."
    );
  const n = e.backoffBaseDelayMs ?? 10, i = e.backoffMaxDelayMs ?? 200;
  if (n < 0 || i < 0)
    throw new b(
      "INVALID_BATCH_GET_BACKOFF",
      "BatchGet backoff delays must be >= 0."
    );
  const a = [], r = Pt(e.keys, 100), s = { requests: 0, retries: 0 }, o = async (c) => {
    c <= 0 || await new Promise((f) => {
      setTimeout(() => f(), c);
    });
  }, l = (c) => {
    if (c <= 0)
      return 0;
    const f = n * Math.pow(2, c - 1);
    return Math.min(i, f);
  }, m = (c) => {
    if (typeof c != "object" || c === null)
      return;
    const f = c;
    if (typeof f.name == "string")
      return f.name;
    if (typeof f.code == "string")
      return f.code;
  }, d = (c) => {
    const f = m(c);
    return f ? (/* @__PURE__ */ new Set([
      "ProvisionedThroughputExceededException",
      "ThrottlingException",
      "RequestLimitExceeded",
      "TooManyRequestsException",
      "InternalServerError",
      "ServiceUnavailable"
    ])).has(f) : !1;
  }, u = async (c, f) => {
    if (c.length === 0)
      return [];
    if (f >= t)
      throw new b(
        "BATCH_GET_UNPROCESSED",
        "Failed to resolve unprocessed keys after retries."
      );
    const N = async (g, C) => {
      s.requests += 1, C > 0 && (s.retries += 1);
      try {
        return await e.documentClient.send(
          new Ge({
            RequestItems: {
              [e.tableName]: {
                Keys: g
              }
            }
          })
        );
      } catch (w) {
        if (e.operationStats?.recordBatchGet({
          tableName: e.tableName,
          keys: g.length,
          items: 0,
          isRetry: C > 0
        }), !d(w))
          throw w;
        const I = C + 1;
        if (I >= t)
          throw w;
        return await o(l(I)), N(g, I);
      }
    }, v = await N(c, f), A = v.Responses?.[e.tableName] ?? [];
    e.operationStats?.recordBatchGet({
      tableName: e.tableName,
      keys: c.length,
      items: A.length,
      isRetry: f > 0
    });
    const h = Kt({
      unprocessed: v.UnprocessedKeys,
      tableName: e.tableName
    });
    if (h.length > 0) {
      const g = f + 1;
      if (g >= t)
        throw new b(
          "BATCH_GET_UNPROCESSED",
          "Failed to resolve unprocessed keys after retries."
        );
      await o(l(g));
      const C = await u(h, g);
      return [...A, ...C];
    }
    return A;
  };
  for (const c of r) {
    const f = Mt(e.keyField, c), N = await u(f, 0);
    a.push(...N);
  }
  if (e.explainDynamoOperations) {
    const c = Math.ceil(e.keys.length / 100);
    console.log(
      `DDB-OP BATCH-GET table=${e.tableName} key=${e.keyField} keys=${e.keys.length} chunks=${c} requests=${s.requests} retries=${s.retries} items=${a.length}`
    );
  }
  return a;
}, Ft = (e) => e.relation === "one-to-one" ? 1 : e.limit !== void 0 ? e.limit : 100, Ot = (e) => {
  if (!(e.baseValues.length > 1))
    return e.limit;
}, Vt = (e) => {
  if (e.adapterConfig.scanPageLimitMode === "unbounded")
    return Number.POSITIVE_INFINITY;
  if (e.adapterConfig.scanMaxPages === void 0)
    throw new b(
      "MISSING_SCAN_LIMIT",
      "Join scan requires scanMaxPages."
    );
  return e.adapterConfig.scanMaxPages;
}, $t = (e) => {
  const t = e.items.map((n) => n[e.field]).filter((n) => n !== void 0);
  return Array.from(new Set(t));
}, _t = (e) => {
  const t = /* @__PURE__ */ new Map();
  for (const n of e.items) {
    const i = n[e.field];
    if (i === void 0)
      continue;
    const a = t.get(i) ?? [];
    t.set(i, [...a, n]);
  }
  return t;
}, Rt = (e) => e === "one-to-one" ? null : [], qt = (e, t) => t === void 0 ? [] : e.get(t) ?? [], le = (e) => [
  {
    field: e.field,
    operator: e.operator,
    value: e.value,
    connector: "AND"
  }
], Lt = async (e) => {
  const t = T({
    model: e.model,
    getDefaultModelName: e.getDefaultModelName,
    config: e.adapterConfig
  }), n = _({
    model: e.model,
    where: e.where,
    getFieldName: e.getFieldName,
    indexNameResolver: e.adapterConfig.indexNameResolver,
    indexKeySchemaResolver: e.adapterConfig.indexKeySchemaResolver
  });
  if (!n)
    throw new b(
      "MISSING_KEY_CONDITION",
      "Join query requires a key condition."
    );
  const i = p({
    model: e.model,
    where: n.remainingWhere,
    getFieldName: e.getFieldName
  });
  return await H({
    documentClient: e.documentClient,
    tableName: t,
    indexName: n.indexName,
    keyConditionExpression: n.keyConditionExpression,
    filterExpression: i.filterExpression,
    expressionAttributeNames: {
      ...n.expressionAttributeNames,
      ...i.expressionAttributeNames
    },
    expressionAttributeValues: {
      ...n.expressionAttributeValues,
      ...i.expressionAttributeValues
    },
    limit: e.limit,
    explainDynamoOperations: e.adapterConfig.explainDynamoOperations,
    operationStats: e.operationStats
  });
}, jt = async (e) => {
  const t = T({
    model: e.model,
    getDefaultModelName: e.getDefaultModelName,
    config: e.adapterConfig
  }), n = p({
    model: e.model,
    where: e.where,
    getFieldName: e.getFieldName
  });
  return await Pe({
    documentClient: e.documentClient,
    tableName: t,
    filterExpression: n.filterExpression,
    expressionAttributeNames: n.expressionAttributeNames,
    expressionAttributeValues: n.expressionAttributeValues,
    limit: e.limit,
    maxPages: e.maxPages,
    explainDynamoOperations: e.adapterConfig.explainDynamoOperations,
    operationStats: e.operationStats
  });
}, Bt = async (e) => {
  if (!e)
    throw new b(
      "MISSING_JOIN_EXECUTION_INPUT",
      "executeJoin requires explicit props."
    );
  const t = $t({
    items: e.baseItems,
    field: e.join.on.from
  });
  if (t.length === 0)
    return e.baseItems.map((l) => ({
      ...l,
      [e.join.modelKey]: Rt(e.join.relation)
    }));
  const n = ut({
    joinField: e.join.on.to,
    model: e.join.model,
    baseValues: t,
    getFieldName: e.getFieldName,
    adapterConfig: e.adapterConfig
  }), i = Ft({
    relation: e.join.relation,
    limit: e.join.limit
  }), r = await (async () => {
    if (n.kind === "batch-get") {
      const u = e.join.on.to;
      return Y({
        documentClient: e.documentClient,
        tableName: T({
          model: e.join.model,
          getDefaultModelName: e.getDefaultModelName,
          config: e.adapterConfig
        }),
        keyField: u,
        keys: t,
        explainDynamoOperations: e.adapterConfig.explainDynamoOperations,
        operationStats: e.operationStats
      });
    }
    if (n.kind === "query") {
      const u = Promise.resolve([]);
      return t.reduce(async (c, f) => {
        const N = await c, x = le({
          field: e.join.on.to,
          operator: "eq",
          value: f
        }), v = await Lt({
          documentClient: e.documentClient,
          adapterConfig: e.adapterConfig,
          model: e.join.model,
          where: x,
          limit: i,
          getFieldName: e.getFieldName,
          getDefaultModelName: e.getDefaultModelName,
          operationStats: e.operationStats
        });
        return [...N, ...v];
      }, u);
    }
    const l = le({
      field: e.join.on.to,
      operator: "in",
      value: t
    }), m = Vt({ adapterConfig: e.adapterConfig }), d = Ot({
      limit: i,
      baseValues: t
    });
    return jt({
      documentClient: e.documentClient,
      adapterConfig: e.adapterConfig,
      model: e.join.model,
      where: l,
      limit: d,
      maxPages: m,
      getFieldName: e.getFieldName,
      getDefaultModelName: e.getDefaultModelName,
      operationStats: e.operationStats
    });
  })(), s = _t({
    items: r,
    field: e.join.on.to
  }), o = (l) => e.join.relation === "one-to-one" ? l[0] ?? null : l.slice(0, i);
  return e.baseItems.map((l) => {
    const m = l[e.join.on.from], d = qt(s, m), u = o(d);
    return {
      ...l,
      [e.join.modelKey]: u
    };
  });
}, Gt = (e) => e.strategy.kind === "batch-get" ? !0 : e.requiresClientFilter, Ut = (e) => {
  if (e.serverSort)
    return e.serverSort.direction === "asc";
}, Ht = (e) => e.strategy.kind !== "query" ? e.keyConditionIndex : e.strategy.key === "gsi" ? e.strategy.indexName : e.keyConditionIndex, Wt = (e) => e.serverSort ? e.items : At(e.items, { sortBy: e.sort }), Qt = (e) => {
  if (e.adapterConfig.scanPageLimitMode === "unbounded")
    return Number.POSITIVE_INFINITY;
  if (e.adapterConfig.scanMaxPages === void 0)
    throw new b(
      "MISSING_SCAN_LIMIT",
      "Scan execution requires scanMaxPages."
    );
  return e.adapterConfig.scanMaxPages;
}, Jt = (e) => e.map((t) => ({
  field: t.field,
  operator: t.operator,
  value: t.value,
  connector: t.connector
})), zt = (e) => {
  const t = e.where.find(
    (n) => n.field === e.primaryKeyName && n.operator === "in"
  );
  return t ? Array.isArray(t.value) ? t.value : [] : [];
}, Yt = async (e) => {
  const t = Jt(e.plan.base.where), n = T({
    model: e.plan.base.model,
    getDefaultModelName: e.getDefaultModelName,
    config: e.adapterConfig
  }), i = e.plan.execution.baseStrategy;
  if (i.kind === "batch-get") {
    const s = e.getFieldName({
      model: e.plan.base.model,
      field: "id"
    }), o = zt({
      where: e.plan.base.where,
      primaryKeyName: s
    });
    return o.length === 0 ? [] : Y({
      documentClient: e.documentClient,
      tableName: n,
      keyField: s,
      keys: o,
      explainDynamoOperations: e.adapterConfig.explainDynamoOperations,
      operationStats: e.operationStats
    });
  }
  if (i.kind === "multi-query") {
    const s = e.plan.base.where.find(
      (u) => u.field === i.field && u.operator === "in"
    );
    if (!s)
      return [];
    if (!Array.isArray(s.value))
      return [];
    const o = s.value, l = e.plan.execution.fetchLimit, m = e.plan.base.model;
    return (await Promise.all(
      o.map(async (u) => {
        const c = t.map((x) => x.field === i.field && x.operator === "in" ? {
          ...x,
          operator: "eq",
          value: u
        } : x), f = _({
          model: m,
          where: c,
          getFieldName: e.getFieldName,
          indexNameResolver: e.adapterConfig.indexNameResolver,
          indexKeySchemaResolver: e.adapterConfig.indexKeySchemaResolver
        });
        if (!f)
          return [];
        const N = p({
          model: m,
          where: f.remainingWhere,
          getFieldName: e.getFieldName
        });
        return await H({
          documentClient: e.documentClient,
          tableName: n,
          indexName: f.indexName ?? i.indexName,
          keyConditionExpression: f.keyConditionExpression,
          filterExpression: N.filterExpression,
          expressionAttributeNames: {
            ...f.expressionAttributeNames,
            ...N.expressionAttributeNames
          },
          expressionAttributeValues: {
            ...f.expressionAttributeValues,
            ...N.expressionAttributeValues
          },
          limit: l,
          explainDynamoOperations: e.adapterConfig.explainDynamoOperations,
          operationStats: e.operationStats
        });
      })
    )).flat();
  }
  if (i.kind === "query") {
    const s = _({
      model: e.plan.base.model,
      where: t,
      getFieldName: e.getFieldName,
      indexNameResolver: e.adapterConfig.indexNameResolver,
      indexKeySchemaResolver: e.adapterConfig.indexKeySchemaResolver
    });
    if (!s)
      throw new b(
        "MISSING_KEY_CONDITION",
        "Query strategy requires a key condition."
      );
    const o = p({
      model: e.plan.base.model,
      where: s.remainingWhere,
      getFieldName: e.getFieldName
    }), l = Ht({
      strategy: i,
      keyConditionIndex: s.indexName
    }), m = Ut({
      serverSort: e.plan.execution.serverSort
    });
    return await H({
      documentClient: e.documentClient,
      tableName: n,
      indexName: l,
      keyConditionExpression: s.keyConditionExpression,
      filterExpression: o.filterExpression,
      expressionAttributeNames: {
        ...s.expressionAttributeNames,
        ...o.expressionAttributeNames
      },
      expressionAttributeValues: {
        ...s.expressionAttributeValues,
        ...o.expressionAttributeValues
      },
      limit: e.plan.execution.fetchLimit,
      scanIndexForward: m,
      explainDynamoOperations: e.adapterConfig.explainDynamoOperations,
      operationStats: e.operationStats
    });
  }
  const a = p({
    model: e.plan.base.model,
    where: t,
    getFieldName: e.getFieldName
  }), r = Qt({ adapterConfig: e.adapterConfig });
  return await Pe({
    documentClient: e.documentClient,
    tableName: n,
    filterExpression: a.filterExpression,
    expressionAttributeNames: a.expressionAttributeNames,
    expressionAttributeValues: a.expressionAttributeValues,
    limit: e.plan.execution.fetchLimit,
    maxPages: r,
    explainDynamoOperations: e.adapterConfig.explainDynamoOperations,
    operationStats: e.operationStats
  });
}, Xt = (e) => {
  const t = e.offset ?? 0;
  return e.limit === void 0 ? e.items.slice(t) : e.items.slice(t, t + e.limit);
}, P = (e) => {
  if (!e)
    throw new b(
      "MISSING_EXECUTOR_INPUT",
      "createQueryPlanExecutor requires explicit props."
    );
  return async (t, n) => {
    const i = await Yt({
      plan: t,
      documentClient: e.documentClient,
      adapterConfig: e.adapterConfig,
      getFieldName: e.getFieldName,
      getDefaultModelName: e.getDefaultModelName,
      operationStats: n?.operationStats
    }), a = Gt({
      strategy: t.execution.baseStrategy,
      requiresClientFilter: t.execution.requiresClientFilter
    }), r = ht({
      items: i,
      where: t.base.where,
      requiresClientFilter: a
    }), s = Wt({
      items: r,
      serverSort: t.execution.serverSort,
      sort: t.base.sort
    }), o = Xt({
      items: s,
      offset: t.base.offset,
      limit: t.base.limit
    }), m = await t.joins.reduce(
      async (c, f) => {
        const N = await c;
        return Bt({
          baseItems: N,
          join: f,
          documentClient: e.documentClient,
          adapterConfig: e.adapterConfig,
          getFieldName: e.getFieldName,
          getDefaultModelName: e.getDefaultModelName,
          operationStats: n?.operationStats
        });
      },
      Promise.resolve(o)
    ), d = t.joins.map((c) => c.modelKey);
    return Ct({
      items: m,
      model: t.base.model,
      select: t.base.select,
      joinKeys: d,
      getFieldName: e.getFieldName
    });
  };
}, Zt = () => ">=1", en = (e) => e === void 0 ? "unknown" : Number.isFinite(e) ? `<=${e}` : "unbounded", tn = (e) => typeof e == "string" || typeof e == "number" || typeof e == "boolean" || e === null ? JSON.stringify(e) : Array.isArray(e) ? `[${e.map((t) => JSON.stringify(t)).join(", ")}]` : "…", nn = (e) => `${e.connector} ${e.field} ${e.operator} ${tn(e.value)}`, j = (e) => e === void 0 ? "∞" : String(e), ue = (e) => e.kind === "query" ? e.key === "pk" ? "query(pk)" : `query(gsi:${e.indexName ?? "?"})` : e.kind === "multi-query" ? `multi-query(gsi:${e.indexName})` : e.kind === "batch-get" ? "batch-get(pk)" : "scan", $ = (e, t) => {
  const n = "  ".repeat(t);
  return e.map((i) => `${n}${i}`);
}, de = (e) => {
  const t = e.where.find((n) => n.operator !== "in" || !Array.isArray(n.value) ? !1 : e.field === void 0 ? !0 : n.field === e.field);
  if (t && Array.isArray(t.value))
    return t.value.length;
}, an = (e) => {
  const t = e.plan.execution.baseStrategy;
  if (t.kind === "scan")
    return e.adapterConfig.scanPageLimitMode === "unbounded" ? "ScanCommand: unbounded" : `ScanCommand: ${en(e.adapterConfig.scanMaxPages)}`;
  if (t.kind === "query")
    return `QueryCommand: ${Zt()}`;
  if (t.kind === "multi-query") {
    const n = de({
      where: e.plan.base.where,
      field: t.field
    });
    return n === void 0 ? "QueryCommand: unknown" : `QueryCommand: =${n}`;
  }
  if (t.kind === "batch-get") {
    const n = de({ where: e.plan.base.where });
    return n === void 0 ? "BatchGetCommand: unknown" : `BatchGetCommand: =${Math.ceil(n / 100)} (chunks=${Math.ceil(n / 100)})`;
  }
  return "unknown";
}, rn = (e) => {
  const t = e.plan, n = T({
    model: t.base.model,
    getDefaultModelName: e.getDefaultModelName,
    config: e.adapterConfig
  }), i = [], a = ue(t.execution.baseStrategy).toUpperCase(), r = j(t.execution.fetchLimit), o = t.execution.baseStrategy.kind !== "scan" ? "n/a" : j(e.adapterConfig.scanMaxPages);
  i.push(
    `-> ${a} table=${n} fetchLimit=${r} scanMaxPages=${o} scanPageLimitMode=${e.adapterConfig.scanPageLimitMode}`
  ), i.push(`   est: ${an({ plan: t, adapterConfig: e.adapterConfig })}`), (t.constraints.hasOrConnector || t.constraints.hasClientOnlyOperator) && i.push(
    `-> FILTER (client) or=${t.constraints.hasOrConnector} clientOnly=${t.constraints.hasClientOnlyOperator}`
  ), t.execution.requiresClientSort && i.push("-> SORT (client)"), (t.base.offset !== void 0 || t.base.limit !== void 0) && i.push(
    `-> LIMIT offset=${t.base.offset ?? 0} limit=${j(t.base.limit)}`
  );
  const l = t.joins.reduce((m, d) => {
    const u = T({
      model: d.model,
      getDefaultModelName: e.getDefaultModelName,
      config: e.adapterConfig
    }), c = ue(d.strategy), f = [];
    return f.push(
      `-> JOIN ${d.modelKey} relation=${d.relation} on ${d.on.from} = ${d.on.to} strategy=${c} table=${u}`
    ), c === "query(pk)" && f.push("   note: uses BATCH-GET when >1 distinct key"), [...f, ...$(m, 1)];
  }, i);
  return t.base.select && t.base.select.length > 0 ? [
    `-> PROJECT (${t.base.select.join(", ")})`,
    ...$(l, 1)
  ] : ["-> PROJECT (*)", ...$(l, 1)];
}, X = (e) => {
  const t = [];
  t.push("EXPLAIN DynamoDBAdapter"), t.push(`QUERY model=${e.plan.base.model}`);
  const n = e.plan.base.where.map((i) => nn(i));
  if (n.length > 0) {
    t.push("WHERE");
    for (const i of n)
      t.push(`  ${i}`);
  } else
    t.push("WHERE (none)");
  return t.push("PLAN"), t.push(...$(rn(e), 1)), t.join(`
`);
}, B = (e, t) => {
  const n = e[t.tableName];
  if (n)
    return n;
  const i = t.makeInitial();
  return e[t.tableName] = i, i;
}, Z = () => {
  const e = {
    totals: {
      scanCommands: 0,
      queryCommands: 0,
      batchGetCommands: 0
    },
    scans: {},
    queries: {},
    batchGets: {}
  };
  return {
    recordScan: (t) => {
      e.totals.scanCommands += 1;
      const n = B(e.scans, {
        tableName: t.tableName,
        makeInitial: () => ({ commands: 0, items: 0 })
      });
      n.commands += 1, n.items += t.items;
    },
    recordQuery: (t) => {
      e.totals.queryCommands += 1;
      const n = B(e.queries, {
        tableName: t.tableName,
        makeInitial: () => ({ commands: 0, items: 0 })
      });
      n.commands += 1, n.items += t.items;
    },
    recordBatchGet: (t) => {
      e.totals.batchGetCommands += 1;
      const n = B(e.batchGets, {
        tableName: t.tableName,
        makeInitial: () => ({ commands: 0, keys: 0, retries: 0, items: 0 })
      });
      n.commands += 1, n.keys += t.keys, n.items += t.items, t.isRetry && (n.retries += 1);
    },
    snapshot: () => e
  };
}, G = (e) => Object.keys(e).sort((t, n) => t.localeCompare(n)), ee = (e) => {
  const t = [];
  t.push("ACTUAL"), t.push(
    `  commands: ScanCommand=${e.totals.scanCommands} QueryCommand=${e.totals.queryCommands} BatchGetCommand=${e.totals.batchGetCommands}`
  );
  for (const n of G(e.scans)) {
    const i = e.scans[n];
    t.push(
      `  SCAN table=${n} commands=${i.commands} items=${i.items}`
    );
  }
  for (const n of G(e.queries)) {
    const i = e.queries[n];
    t.push(
      `  QUERY table=${n} commands=${i.commands} items=${i.items}`
    );
  }
  for (const n of G(e.batchGets)) {
    const i = e.batchGets[n];
    t.push(
      `  BATCH-GET table=${n} commands=${i.commands} keys=${i.keys} retries=${i.retries} items=${i.items}`
    );
  }
  return t.join(`
`);
}, sn = (e, t) => {
  const { documentClient: n } = e, { adapterConfig: i, getFieldName: a, getDefaultModelName: r } = t, s = () => {
    if (i.scanPageLimitMode === "unbounded")
      return Number.POSITIVE_INFINITY;
    if (i.scanMaxPages === void 0)
      throw new b(
        "MISSING_SCAN_LIMIT",
        "Count scan requires scanMaxPages."
      );
    return i.scanMaxPages;
  };
  return async ({
    model: o,
    where: l
  }) => {
    const d = (() => {
      if (i.explainQueryPlans)
        return Z();
    })(), u = (h) => (i.explainQueryPlans && d && console.log(ee(d.snapshot())), h), c = K({
      model: o,
      where: l,
      select: void 0,
      sortBy: void 0,
      limit: void 0,
      offset: void 0,
      join: void 0,
      getFieldName: a,
      adapterConfig: i
    });
    if (i.explainQueryPlans && console.log(
      X({
        plan: c,
        adapterConfig: i,
        getDefaultModelName: r
      })
    ), c.execution.requiresClientFilter) {
      const g = await P({
        documentClient: n,
        adapterConfig: i,
        getFieldName: a,
        getDefaultModelName: r
      })(c, { operationStats: d });
      return u(g.length);
    }
    if (c.execution.baseStrategy.kind === "batch-get") {
      const g = await P({
        documentClient: n,
        adapterConfig: i,
        getFieldName: a,
        getDefaultModelName: r
      })(c, { operationStats: d });
      return u(g.length);
    }
    const f = T({
      model: o,
      getDefaultModelName: r,
      config: i
    }), N = c.base.where.map((h) => ({
      field: h.field,
      operator: h.operator,
      value: h.value,
      connector: h.connector
    }));
    if (c.execution.baseStrategy.kind === "query") {
      const h = _({
        model: o,
        where: N,
        getFieldName: a,
        indexNameResolver: i.indexNameResolver,
        indexKeySchemaResolver: i.indexKeySchemaResolver
      });
      if (!h)
        throw new b(
          "MISSING_KEY_CONDITION",
          "Count query requires a key condition."
        );
      const g = p({
        model: o,
        where: h.remainingWhere,
        getFieldName: a
      }), C = await pt({
        documentClient: n,
        tableName: f,
        indexName: h.indexName,
        keyConditionExpression: h.keyConditionExpression,
        filterExpression: g.filterExpression,
        expressionAttributeNames: {
          ...h.expressionAttributeNames,
          ...g.expressionAttributeNames
        },
        expressionAttributeValues: {
          ...h.expressionAttributeValues,
          ...g.expressionAttributeValues
        },
        explainDynamoOperations: i.explainDynamoOperations,
        operationStats: d
      });
      return u(C);
    }
    const x = p({
      model: o,
      where: N,
      getFieldName: a
    }), v = s(), A = await Dt({
      documentClient: n,
      tableName: f,
      filterExpression: x.filterExpression,
      expressionAttributeNames: x.expressionAttributeNames,
      expressionAttributeValues: x.expressionAttributeValues,
      maxPages: v,
      explainDynamoOperations: i.explainDynamoOperations,
      operationStats: d
    });
    return u(A);
  };
}, on = () => ({
  operations: []
}), te = (e, t) => {
  if (e.operations.length >= 25)
    throw new b(
      "TRANSACTION_LIMIT",
      "DynamoDB transactions are limited to 25 operations."
    );
  e.operations.push(t);
}, ln = (e) => e.kind === "put" ? {
  Put: {
    TableName: e.tableName,
    Item: e.item
  }
} : e.kind === "update" ? {
  Update: {
    TableName: e.tableName,
    Key: e.key,
    UpdateExpression: e.updateExpression,
    ExpressionAttributeNames: e.expressionAttributeNames,
    ExpressionAttributeValues: e.expressionAttributeValues
  }
} : {
  Delete: {
    TableName: e.tableName,
    Key: e.key
  }
}, un = async (e) => {
  const { documentClient: t, state: n } = e;
  if (n.operations.length === 0)
    return;
  const i = n.operations.map(
    (a) => ln(a)
  );
  await t.send(
    new Ue({
      TransactItems: i
    })
  );
}, dn = (e, t) => {
  const { documentClient: n } = e, { adapterConfig: i, getDefaultModelName: a, transactionState: r } = t, s = (o) => T({
    model: o,
    getDefaultModelName: a,
    config: i
  });
  return async ({
    model: o,
    data: l
  }) => {
    const m = s(o);
    return r ? (te(r, {
      kind: "put",
      tableName: m,
      item: l
    }), l) : (await n.send(
      new He({
        TableName: m,
        Item: l
      })
    ), l);
  };
}, Me = (e) => {
  const { item: t, keyField: n } = e;
  if (!(n in t))
    throw new b(
      "MISSING_PRIMARY_KEY",
      `Item is missing primary key field "${n}".`
    );
  return { [n]: t[n] };
}, Ke = (e, t) => {
  const { documentClient: n } = e, {
    adapterConfig: i,
    getFieldName: a,
    getDefaultModelName: r,
    transactionState: s
  } = t, o = P({
    documentClient: n,
    adapterConfig: i,
    getFieldName: a,
    getDefaultModelName: r
  }), l = (d) => T({
    model: d,
    getDefaultModelName: r,
    config: i
  }), m = (d) => a({ model: d, field: "id" });
  return async ({ model: d, where: u, limit: c }) => {
    const f = l(d), N = K({
      model: d,
      where: u,
      select: void 0,
      sortBy: void 0,
      limit: c,
      offset: void 0,
      join: void 0,
      getFieldName: a,
      adapterConfig: i
    }), x = await o(N);
    if (x.length === 0)
      return 0;
    const v = m(d), A = { deleted: 0 };
    for (const h of x) {
      const g = Me({
        item: h,
        keyField: v
      });
      s ? te(s, {
        kind: "delete",
        tableName: f,
        key: g
      }) : await n.send(
        new We({
          TableName: f,
          Key: g
        })
      ), A.deleted += 1;
    }
    return A.deleted;
  };
}, cn = (e, t) => {
  const n = Ke(e, t);
  return async ({ model: i, where: a }) => n({ model: i, where: a });
}, mn = (e, t) => {
  const n = Ke(e, t);
  return async ({
    model: i,
    where: a
  }) => {
    await n({ model: i, where: a, limit: 1 });
  };
}, fn = (e, t) => {
  const { documentClient: n } = e, {
    adapterConfig: i,
    getFieldName: a,
    getDefaultModelName: r
  } = t, s = P({
    documentClient: n,
    adapterConfig: i,
    getFieldName: a,
    getDefaultModelName: r
  });
  return async ({
    model: o,
    where: l,
    limit: m,
    sortBy: d,
    offset: u,
    join: c
  }) => {
    const f = K({
      model: o,
      where: l,
      select: void 0,
      sortBy: d,
      limit: m,
      offset: u,
      join: c,
      getFieldName: a,
      adapterConfig: i
    }), x = (() => {
      if (i.explainQueryPlans)
        return Z();
    })();
    i.explainQueryPlans && console.log(
      X({
        plan: f,
        adapterConfig: i,
        getDefaultModelName: r
      })
    );
    const v = await s(f, { operationStats: x });
    return i.explainQueryPlans && x && console.log(ee(x.snapshot())), v;
  };
}, yn = (e, t) => {
  const n = fn(e, t);
  return async (i) => await n(i);
}, bn = (e) => {
  const { transactionState: t, tableName: n, where: i } = e, a = t.operations.filter(
    (o) => o.kind === "put" && o.tableName === n
  ).map((o) => o.item);
  if (a.length === 0)
    return { found: !1 };
  const r = we({ where: i }), s = pe({
    items: a,
    where: r
  });
  return s.length === 0 ? { found: !1 } : { found: !0, item: s[s.length - 1] };
}, Nn = (e, t) => {
  const n = P({
    documentClient: e.documentClient,
    adapterConfig: t.adapterConfig,
    getFieldName: t.getFieldName,
    getDefaultModelName: t.getDefaultModelName
  });
  return async ({
    model: i,
    where: a,
    select: r,
    join: s
  }) => {
    if (t.transactionState) {
      const u = T({
        model: i,
        getDefaultModelName: t.getDefaultModelName,
        config: t.adapterConfig
      }), c = bn({
        transactionState: t.transactionState,
        tableName: u,
        where: a
      });
      if (c.found)
        return c.item;
    }
    if (t.primaryKeyLoader && s === void 0 && r === void 0 && a.length === 1) {
      const u = a[0], c = u.operator ?? "eq", f = (u.connector ?? "AND").toUpperCase(), N = t.getFieldName({ model: i, field: "id" });
      if (c === "eq" && f === "AND" && u.field === N) {
        const x = u.value;
        return x === void 0 ? null : await t.primaryKeyLoader.load({ model: i, key: x }) ?? null;
      }
    }
    const o = K({
      model: i,
      where: a,
      select: r,
      sortBy: void 0,
      limit: 1,
      offset: 0,
      join: s,
      getFieldName: t.getFieldName,
      adapterConfig: t.adapterConfig
    }), m = (() => {
      if (t.adapterConfig.explainQueryPlans)
        return Z();
    })();
    t.adapterConfig.explainQueryPlans && console.log(
      X({
        plan: o,
        adapterConfig: t.adapterConfig,
        getDefaultModelName: t.getDefaultModelName
      })
    );
    const d = await n(o, { operationStats: m });
    return t.adapterConfig.explainQueryPlans && m && console.log(ee(m.snapshot())), d.length === 0 ? null : d[0];
  };
}, ce = (e) => e !== null && typeof e == "object" && !Array.isArray(e), W = (e, t, n) => {
  if (Object.is(t, n))
    return [];
  if (typeof t != typeof n)
    return [{ path: e, prev: t, next: n }];
  if (Array.isArray(t) && Array.isArray(n)) {
    const i = Math.max(t.length, n.length);
    return Array.from({ length: i }, (a, r) => {
      const s = t[r], o = n[r];
      return W([...e, r], s, o);
    }).flat();
  }
  if (ce(t) && ce(n)) {
    const i = /* @__PURE__ */ new Set([...Object.keys(t), ...Object.keys(n)]);
    return Array.from(i).flatMap(
      (a) => W([...e, a], t[a], n[a])
    );
  }
  return [{ path: e, prev: t, next: n }];
}, me = (e) => {
  const t = /* @__PURE__ */ new Map(), n = { value: 0 };
  return (i) => {
    const a = t.get(i);
    if (a)
      return a;
    const r = `${e}${n.value}`;
    return n.value += 1, t.set(i, r), r;
  };
}, xn = (e, t) => typeof e < "u" && typeof t > "u", gn = (e, t) => typeof e == "number" && typeof t == "number", hn = (e, t) => typeof e != typeof t, vn = (e, t) => typeof e == typeof t, fe = (e) => {
  if (typeof e == "string")
    return e;
  try {
    return JSON.stringify(e);
  } catch {
    throw new b(
      "INVALID_UPDATE",
      "Failed to serialize update value."
    );
  }
}, Sn = (e) => {
  if (Object.is(e.prev, e.next))
    return {
      kind: "noop",
      expression: "",
      attributeNames: {},
      attributeValues: {}
    };
  const t = e.path.filter(
    (o) => typeof o == "string"
  ), n = t.map(
    (o) => e.makeNameKey(o)
  ), i = (o) => o === "" ? "" : ".", a = e.path.reduce((o, l) => {
    if (typeof l == "number")
      return `${o}[${l}]`;
    const m = i(o);
    return `${o}${m}#${e.makeNameKey(l)}`;
  }, ""), r = n.map((o, l) => [
    `#${o}`,
    t[l].toString()
  ]), s = Object.fromEntries(r);
  if (xn(e.prev, e.next))
    return {
      kind: "remove",
      expression: a,
      attributeNames: s,
      attributeValues: {}
    };
  if (gn(e.prev, e.next)) {
    const o = e.next - e.prev, l = e.makeValueKey(fe(o));
    return {
      kind: "add",
      expression: `${a} :${l}`,
      attributeNames: s,
      attributeValues: {
        [`:${l}`]: o
      }
    };
  }
  if (vn(e.prev, e.next) || hn(e.prev, e.next)) {
    const o = e.makeValueKey(fe(e.next));
    return {
      kind: "set",
      expression: `${a} = :${o}`,
      attributeNames: s,
      attributeValues: {
        [`:${o}`]: e.next
      }
    };
  }
  return {
    kind: "noop",
    expression: "",
    attributeNames: {},
    attributeValues: {}
  };
}, An = (e) => {
  const t = e.reduce(
    (i, a) => {
      const r = i[a.kind] ?? [];
      return i[a.kind] = [...r, a], i;
    },
    {}
  ), n = Object.entries(t).reduce(
    (i, [a, r]) => {
      if (a === "noop")
        return i;
      const s = r.map((o) => o.expression).join(",");
      return {
        updateExpression: [...i.updateExpression, `${a.toUpperCase()} ${s}`],
        attributeNames: r.reduce(
          (o, l) => ({ ...o, ...l.attributeNames }),
          i.attributeNames
        ),
        attributeValues: r.reduce(
          (o, l) => ({ ...o, ...l.attributeValues }),
          i.attributeValues
        )
      };
    },
    {
      updateExpression: [],
      attributeNames: {},
      attributeValues: {}
    }
  );
  return {
    updateExpression: n.updateExpression.join(" "),
    attributeNames: n.attributeNames,
    attributeValues: n.attributeValues
  };
}, Cn = (e) => {
  if (!e)
    throw new b(
      "INVALID_UPDATE",
      "Patch update requires explicit prev/next."
    );
  const t = W([], e.prev, e.next);
  if (t.length === 0)
    throw new b(
      "INVALID_UPDATE",
      "Update payload must include at least one defined value."
    );
  const n = me("a"), i = me("v"), a = t.map(
    (s) => Sn({
      ...s,
      makeNameKey: n,
      makeValueKey: i
    })
  ), r = An(a);
  if (!r.updateExpression)
    throw new b(
      "INVALID_UPDATE",
      "Update payload must include at least one defined value."
    );
  return {
    updateExpression: r.updateExpression,
    expressionAttributeNames: r.attributeNames,
    expressionAttributeValues: r.attributeValues
  };
}, Tn = (e, t) => Object.entries(t).reduce(
  (n, [i, a]) => ({ ...n, [i]: a }),
  { ...e }
), In = (e) => Object.entries(e).reduce(
  (n, [i, a]) => a === void 0 ? n : { ...n, [i]: a },
  {}
), wn = (e) => e ? { ReturnValues: "ALL_NEW" } : {}, Fe = (e, t) => {
  const { documentClient: n } = e, {
    adapterConfig: i,
    getFieldName: a,
    getDefaultModelName: r,
    transactionState: s
  } = t, o = P({
    documentClient: n,
    adapterConfig: i,
    getFieldName: a,
    getDefaultModelName: r
  }), l = (d) => T({
    model: d,
    getDefaultModelName: r,
    config: i
  }), m = (d) => a({ model: d, field: "id" });
  return async ({
    model: d,
    where: u,
    update: c,
    limit: f,
    returnUpdatedItems: N
  }) => {
    const x = l(d), v = K({
      model: d,
      where: u,
      select: void 0,
      sortBy: void 0,
      limit: f,
      offset: void 0,
      join: void 0,
      getFieldName: a,
      adapterConfig: i
    }), A = await o(v);
    if (A.length === 0)
      return { updatedCount: 0, updatedItems: [] };
    const h = m(d), g = {
      updatedCount: 0,
      updatedItems: []
    };
    for (const C of A) {
      const w = Tn(
        C,
        c
      ), I = Cn({
        prev: C,
        next: w
      }), M = Me({
        item: C,
        keyField: h
      });
      if (s)
        te(s, {
          kind: "update",
          tableName: x,
          key: M,
          updateExpression: I.updateExpression,
          expressionAttributeNames: I.expressionAttributeNames,
          expressionAttributeValues: I.expressionAttributeValues
        }), N && g.updatedItems.push(
          In(w)
        );
      else {
        const D = {
          TableName: x,
          Key: M,
          UpdateExpression: I.updateExpression,
          ExpressionAttributeNames: I.expressionAttributeNames,
          ExpressionAttributeValues: I.expressionAttributeValues,
          ...wn(N)
        }, F = await n.send(
          new Qe(D)
        );
        N && F.Attributes && g.updatedItems.push(
          F.Attributes
        );
      }
      g.updatedCount += 1;
    }
    return g;
  };
}, En = (e, t) => {
  const n = Fe(e, t);
  return async ({
    model: i,
    where: a,
    update: r
  }) => (await n({
    model: i,
    where: a,
    update: r,
    returnUpdatedItems: !1
  })).updatedCount;
}, kn = (e, t) => {
  const n = Fe(e, t);
  return async ({
    model: i,
    where: a,
    update: r
  }) => {
    const s = await n({
      model: i,
      where: a,
      update: r,
      limit: 1,
      returnUpdatedItems: !0
    });
    return s.updatedItems.length === 0 ? null : s.updatedItems[0];
  };
}, ye = (e) => String(e), pn = (e) => `${e.tableName}:${e.keyField}`, Dn = (e) => {
  if (!e)
    throw new b(
      "MISSING_EXECUTOR_INPUT",
      "createPrimaryKeyBatchLoader requires explicit props."
    );
  const t = /* @__PURE__ */ new Map(), n = (r) => {
    const s = T({
      model: r,
      getDefaultModelName: e.getDefaultModelName,
      config: e.adapterConfig
    }), o = e.getFieldName({ model: r, field: "id" }), l = pn({ tableName: s, keyField: o }), m = t.get(l);
    if (m)
      return m;
    const d = {
      model: r,
      keyField: o,
      tableName: s,
      scheduled: !1,
      pendingByToken: /* @__PURE__ */ new Map()
    };
    return t.set(l, d), d;
  }, i = async (r) => {
    if (r.pendingByToken.size === 0) {
      r.scheduled = !1;
      return;
    }
    const s = new Map(r.pendingByToken);
    r.pendingByToken.clear(), r.scheduled = !1;
    const o = Array.from(s.values()).map((l) => l.key);
    if (e.adapterConfig.explainQueryPlans) {
      const l = Math.ceil(o.length / 100);
      console.log(
        [
          "EXPLAIN DynamoDBAdapter",
          `BATCH-GET model=${r.model} table=${r.tableName} key=${r.keyField}`,
          "PLAN",
          `  -> BATCH-GET keys=${o.length} chunks=${l} estimatedCommands=${l}`
        ].join(`
`)
      );
    }
    try {
      const l = await Y({
        documentClient: e.documentClient,
        tableName: r.tableName,
        keyField: r.keyField,
        keys: o,
        explainDynamoOperations: e.adapterConfig.explainDynamoOperations
      }), m = /* @__PURE__ */ new Map();
      for (const d of l) {
        const u = d[r.keyField];
        u !== void 0 && m.set(ye(u), d);
      }
      for (const [d, u] of s.entries()) {
        const c = m.get(d) ?? null;
        for (const f of u.pending)
          f.resolve(c);
      }
    } catch (l) {
      for (const m of s.values())
        for (const d of m.pending)
          d.reject(l);
    }
  }, a = (r) => {
    r.scheduled || (r.scheduled = !0, queueMicrotask(() => {
      i(r);
    }));
  };
  return {
    load: async (r) => {
      const s = n(r.model), o = ye(r.key);
      return new Promise((l, m) => {
        const d = s.pendingByToken.get(o);
        if (d) {
          d.pending.push({ resolve: l, reject: m });
          return;
        }
        s.pendingByToken.set(o, {
          key: r.key,
          pending: [{ resolve: l, reject: m }]
        }), a(s);
      });
    }
  };
}, Pn = (e) => {
  if (!e)
    throw new b("MISSING_CLIENT", "DynamoDB adapter requires a DynamoDBDocumentClient instance.");
  return e;
}, be = (e) => {
  const { documentClient: t, adapterConfig: n, transactionState: i } = e;
  return ({ getFieldName: a, getDefaultModelName: r }) => {
    const s = { documentClient: t }, o = Dn({
      documentClient: t,
      adapterConfig: n,
      getFieldName: a,
      getDefaultModelName: r
    }), l = {
      adapterConfig: n,
      getFieldName: a,
      getDefaultModelName: r
    }, m = l, d = {
      ...l,
      transactionState: i
    }, u = {
      ...l,
      transactionState: i
    };
    return {
      create: dn(s, {
        adapterConfig: n,
        getDefaultModelName: r,
        transactionState: i
      }),
      findOne: Nn(s, {
        ...l,
        primaryKeyLoader: o,
        transactionState: i
      }),
      findMany: yn(s, l),
      count: sn(s, m),
      update: kn(s, d),
      updateMany: En(s, d),
      delete: mn(s, u),
      deleteMany: cn(s, u)
    };
  };
}, Bn = (e) => {
  if (!e.indexNameResolver)
    throw new b(
      "MISSING_INDEX_RESOLVER",
      "DynamoDB adapter requires indexNameResolver."
    );
  const t = {
    documentClient: e.documentClient,
    debugLogs: e.debugLogs,
    usePlural: e.usePlural ?? !1,
    tableNamePrefix: e.tableNamePrefix,
    tableNameResolver: e.tableNameResolver,
    scanMaxPages: e.scanMaxPages,
    scanPageLimitMode: e.scanPageLimitMode ?? "throw",
    explainQueryPlans: e.explainQueryPlans ?? !1,
    explainDynamoOperations: e.explainDynamoOperations ?? !1,
    indexNameResolver: e.indexNameResolver,
    indexKeySchemaResolver: e.indexKeySchemaResolver,
    transaction: e.transaction ?? !1
  }, n = Pn(t.documentClient), i = { value: null }, a = {
    config: {
      adapterId: "dynamodb-adapter",
      adapterName: "DynamoDB Adapter",
      usePlural: t.usePlural,
      debugLogs: t.debugLogs ?? !1,
      supportsArrays: !0,
      supportsJSON: !0,
      supportsUUIDs: !1,
      supportsNumericIds: !1,
      supportsDates: !1,
      customIdGenerator: e.customIdGenerator ?? (() => Be()),
      disableIdGeneration: e.disableIdGeneration,
      mapKeysTransformInput: e.mapKeysTransformInput,
      mapKeysTransformOutput: e.mapKeysTransformOutput,
      customTransformInput: e.customTransformInput,
      customTransformOutput: e.customTransformOutput,
      transaction: !1
    },
    adapter: be({
      documentClient: n,
      adapterConfig: t
    })
  };
  t.transaction && (a.config.transaction = async (s) => {
    const o = i.value;
    if (!o)
      throw new b("MISSING_CLIENT", "DynamoDB adapter options are not initialized.");
    const l = on(), m = ne({
      config: { ...a.config, transaction: !1 },
      adapter: be({
        documentClient: n,
        adapterConfig: t,
        transactionState: l
      })
    })(o), d = await s(m);
    return await un({ documentClient: n, state: l }), d;
  });
  const r = ne(a);
  return (s) => (i.value = s, r(s));
}, U = async (e) => {
  e <= 0 || await new Promise((t) => {
    setTimeout(() => t(), e);
  });
}, Mn = async (e) => {
  const t = [], n = { lastEvaluatedTableName: void 0 };
  for (; ; ) {
    const i = await e.send(
      new Ye({
        ExclusiveStartTableName: n.lastEvaluatedTableName
      })
    );
    if (t.push(...i.TableNames ?? []), n.lastEvaluatedTableName = i.LastEvaluatedTableName, !n.lastEvaluatedTableName)
      break;
  }
  return t;
}, Q = async (e, t) => {
  const n = await e.send(new Xe({ TableName: t }));
  if (!n.Table)
    throw new b(
      "MISSING_TABLE_SCHEMA",
      `DescribeTable did not return a Table for ${t}.`
    );
  return n.Table;
}, Ne = (e) => (e ?? []).map((n) => ({
  attributeName: n.AttributeName ?? "",
  keyType: n.KeyType ?? ""
})).filter((n) => n.attributeName.length > 0 && n.keyType.length > 0), xe = (e) => {
  const t = e?.ProjectionType ?? "", n = [...e?.NonKeyAttributes ?? []].sort(
    (i, a) => i.localeCompare(a)
  );
  return { projectionType: t, nonKeyAttributes: n };
}, ge = (e) => ({
  read: e?.ReadCapacityUnits,
  write: e?.WriteCapacityUnits
}), Kn = (e) => {
  const t = Ne(e.existing.KeySchema), n = Ne(e.desired.KeySchema);
  if (t.length !== n.length)
    return !1;
  for (const [o, l] of t.entries()) {
    const m = n[o];
    if (!m || l.attributeName !== m.attributeName || l.keyType !== m.keyType)
      return !1;
  }
  const i = xe(e.existing.Projection), a = xe(e.desired.Projection);
  if (i.projectionType !== a.projectionType || i.nonKeyAttributes.length !== a.nonKeyAttributes.length)
    return !1;
  for (const [o, l] of i.nonKeyAttributes.entries())
    if (l !== a.nonKeyAttributes[o])
      return !1;
  const r = ge(e.existing.ProvisionedThroughput), s = ge(e.desired.ProvisionedThroughput);
  return !(r.read !== s.read || r.write !== s.write);
}, Fn = (e) => (e.GlobalSecondaryIndexes ?? []).reduce((n, i) => (n.set(i.IndexName ?? "", i), n), /* @__PURE__ */ new Map()), Oe = (e) => (e.attributeDefinitions ?? []).reduce((n, i) => (i.AttributeName && n.set(i.AttributeName, i), n), /* @__PURE__ */ new Map()), On = (e) => (e.KeySchema ?? []).map((n) => n.AttributeName).filter((n) => typeof n == "string" && n.length > 0), Vn = (e) => {
  const t = Oe({
    attributeDefinitions: e.desiredTableAttributeDefinitions
  }), n = [], i = On(e.index);
  for (const a of i) {
    const r = e.existing.get(a);
    if (r) {
      const o = t.get(a);
      if (o && o.AttributeType && r.AttributeType && o.AttributeType !== r.AttributeType)
        throw new b(
          "ATTRIBUTE_DEFINITION_MISMATCH",
          `Attribute type mismatch for ${a}: existing=${r.AttributeType} desired=${o.AttributeType}`
        );
      continue;
    }
    const s = t.get(a);
    if (!s)
      throw new b(
        "MISSING_ATTRIBUTE_DEFINITION",
        `Missing AttributeDefinition for ${a} required by GSI ${e.index.IndexName ?? "(unknown)"}.`
      );
    n.push(s);
  }
  return n;
}, Ve = async (e) => {
  const t = Date.now(), n = Math.max(0, (e.wait.maxWaitTime ?? 60) * 1e3), i = Math.max(0, (e.wait.minDelay ?? 2) * 1e3), a = e.presentGsiNames ?? [], r = e.absentGsiNames ?? [];
  for (; ; ) {
    const s = await Q(e.client, e.tableName), o = s.TableStatus ?? "", m = (s.GlobalSecondaryIndexes ?? []).reduce((c, f) => {
      const N = f.IndexName ?? "";
      return N.length === 0 || c.set(N, f.IndexStatus ?? ""), c;
    }, /* @__PURE__ */ new Map()), d = a.every((c) => m.get(c) === "ACTIVE"), u = r.every((c) => !m.has(c));
    if (o !== "ACTIVE") {
      if (Date.now() - t > n)
        throw new b(
          "TABLE_WAIT_TIMEOUT",
          `Timed out waiting for table ${e.tableName} to become ready.`
        );
      await U(i);
      continue;
    }
    if (!d) {
      if (Date.now() - t > n)
        throw new b(
          "TABLE_WAIT_TIMEOUT",
          `Timed out waiting for table ${e.tableName} to become ready.`
        );
      await U(i);
      continue;
    }
    if (!u) {
      if (Date.now() - t > n)
        throw new b(
          "TABLE_WAIT_TIMEOUT",
          `Timed out waiting for table ${e.tableName} to become ready.`
        );
      await U(i);
      continue;
    }
    return;
  }
}, $n = async (e) => {
  await e.client.send(
    new Ae({
      TableName: e.tableName,
      GlobalSecondaryIndexUpdates: [
        {
          Delete: { IndexName: e.indexName }
        }
      ]
    })
  ), await Ve({
    client: e.client,
    tableName: e.tableName,
    wait: e.wait,
    absentGsiNames: [e.indexName]
  });
}, he = async (e) => {
  const t = Oe({
    attributeDefinitions: e.existingAttributeDefinitions
  }), n = Vn({
    existing: t,
    desiredTableAttributeDefinitions: e.desiredTableAttributeDefinitions,
    index: e.index
  });
  await e.client.send(
    new Ae({
      TableName: e.tableName,
      AttributeDefinitions: n.length > 0 ? n : void 0,
      GlobalSecondaryIndexUpdates: [
        {
          Create: {
            IndexName: e.index.IndexName,
            KeySchema: e.index.KeySchema,
            Projection: e.index.Projection,
            ProvisionedThroughput: e.index.ProvisionedThroughput
          }
        }
      ]
    })
  ), await Ve({
    client: e.client,
    tableName: e.tableName,
    wait: e.wait,
    presentGsiNames: [e.index.IndexName ?? ""].filter((i) => i.length > 0)
  });
}, _n = async (e) => {
  if (!e.client)
    throw new b(
      "MISSING_CLIENT",
      "DynamoDB applyTableSchemas requires a DynamoDBClient instance."
    );
  const t = e.wait ?? { maxWaitTime: 60, minDelay: 2 }, n = await Mn(e.client), i = [], a = /* @__PURE__ */ new Set();
  for (const r of e.tables) {
    const s = r.tableDefinition, o = s.globalSecondaryIndexes ?? [];
    if (!n.includes(r.tableName)) {
      await e.client.send(
        new Je({
          TableName: r.tableName,
          AttributeDefinitions: s.attributeDefinitions,
          KeySchema: s.keySchema,
          BillingMode: s.billingMode,
          GlobalSecondaryIndexes: s.globalSecondaryIndexes
        })
      ), await ze(
        { client: e.client, ...t },
        { TableName: r.tableName }
      ), i.push(r.tableName);
      continue;
    }
    if (o.length === 0)
      continue;
    const l = await Q(e.client, r.tableName), m = Fn(l);
    for (const d of o) {
      const u = d.IndexName ?? "";
      if (u.length === 0)
        continue;
      const c = m.get(u);
      if (!c) {
        await he({
          client: e.client,
          tableName: r.tableName,
          index: d,
          existingAttributeDefinitions: l.AttributeDefinitions,
          desiredTableAttributeDefinitions: s.attributeDefinitions,
          wait: t
        }), a.add(r.tableName);
        continue;
      }
      if (Kn({
        existing: c,
        desired: d
      }))
        continue;
      await $n({
        client: e.client,
        tableName: r.tableName,
        indexName: u,
        wait: t
      });
      const N = await Q(e.client, r.tableName);
      await he({
        client: e.client,
        tableName: r.tableName,
        index: d,
        existingAttributeDefinitions: N.AttributeDefinitions,
        desiredTableAttributeDefinitions: s.attributeDefinitions,
        wait: t
      }), a.add(r.tableName);
    }
  }
  return {
    createdTables: i,
    updatedTables: Array.from(a.values())
  };
}, Gn = async (e) => (await _n(e)).createdTables, Un = (e) => {
  if (e.length === 0)
    throw new Error("index resolver creation requires table schemas.");
  const t = /* @__PURE__ */ new Map(), n = /* @__PURE__ */ new Map();
  for (const i of e)
    for (const a of i.indexMappings) {
      const r = `${i.tableName}:${a.partitionKey}`;
      if (t.has(r))
        throw new Error(
          `Duplicate partition key mapping for ${i.tableName}.${a.partitionKey}.`
        );
      t.set(r, a);
      const s = `${i.tableName}:${a.indexName}`;
      if (n.has(s))
        throw new Error(
          `Duplicate index name mapping for ${i.tableName}.${a.indexName}.`
        );
      n.set(s, a);
    }
  return {
    indexNameResolver: ({ model: i, field: a }) => t.get(`${i}:${a}`)?.indexName,
    indexKeySchemaResolver: ({ model: i, indexName: a }) => {
      const r = n.get(`${i}:${a}`);
      if (r)
        return {
          partitionKey: r.partitionKey,
          sortKey: r.sortKey
        };
    }
  };
}, Hn = [
  {
    tableName: "user",
    tableDefinition: {
      attributeDefinitions: [
        { AttributeName: "id", AttributeType: "S" },
        { AttributeName: "email", AttributeType: "S" },
        { AttributeName: "username", AttributeType: "S" }
      ],
      keySchema: [{ AttributeName: "id", KeyType: "HASH" }],
      billingMode: "PAY_PER_REQUEST",
      globalSecondaryIndexes: [
        {
          IndexName: "user_email_idx",
          KeySchema: [{ AttributeName: "email", KeyType: "HASH" }],
          Projection: { ProjectionType: "ALL" }
        },
        {
          IndexName: "user_username_idx",
          KeySchema: [{ AttributeName: "username", KeyType: "HASH" }],
          Projection: { ProjectionType: "ALL" }
        }
      ]
    },
    indexMappings: [
      { indexName: "user_email_idx", partitionKey: "email" },
      { indexName: "user_username_idx", partitionKey: "username" }
    ]
  },
  {
    tableName: "session",
    tableDefinition: {
      attributeDefinitions: [
        { AttributeName: "id", AttributeType: "S" },
        { AttributeName: "userId", AttributeType: "S" },
        { AttributeName: "token", AttributeType: "S" },
        { AttributeName: "createdAt", AttributeType: "S" }
      ],
      keySchema: [{ AttributeName: "id", KeyType: "HASH" }],
      billingMode: "PAY_PER_REQUEST",
      globalSecondaryIndexes: [
        {
          IndexName: "session_userId_idx",
          KeySchema: [
            { AttributeName: "userId", KeyType: "HASH" },
            { AttributeName: "createdAt", KeyType: "RANGE" }
          ],
          Projection: { ProjectionType: "ALL" }
        },
        {
          IndexName: "session_token_idx",
          KeySchema: [
            { AttributeName: "token", KeyType: "HASH" },
            { AttributeName: "createdAt", KeyType: "RANGE" }
          ],
          Projection: { ProjectionType: "ALL" }
        }
      ]
    },
    indexMappings: [
      {
        indexName: "session_userId_idx",
        partitionKey: "userId",
        sortKey: "createdAt"
      },
      {
        indexName: "session_token_idx",
        partitionKey: "token",
        sortKey: "createdAt"
      }
    ]
  },
  {
    tableName: "account",
    tableDefinition: {
      attributeDefinitions: [
        { AttributeName: "id", AttributeType: "S" },
        { AttributeName: "userId", AttributeType: "S" },
        { AttributeName: "providerId", AttributeType: "S" },
        { AttributeName: "accountId", AttributeType: "S" }
      ],
      keySchema: [{ AttributeName: "id", KeyType: "HASH" }],
      billingMode: "PAY_PER_REQUEST",
      globalSecondaryIndexes: [
        {
          IndexName: "account_accountId_idx",
          KeySchema: [{ AttributeName: "accountId", KeyType: "HASH" }],
          Projection: { ProjectionType: "ALL" }
        },
        {
          IndexName: "account_userId_idx",
          KeySchema: [{ AttributeName: "userId", KeyType: "HASH" }],
          Projection: { ProjectionType: "ALL" }
        },
        {
          IndexName: "account_providerId_accountId_idx",
          KeySchema: [
            { AttributeName: "providerId", KeyType: "HASH" },
            { AttributeName: "accountId", KeyType: "RANGE" }
          ],
          Projection: { ProjectionType: "ALL" }
        }
      ]
    },
    indexMappings: [
      { indexName: "account_accountId_idx", partitionKey: "accountId" },
      { indexName: "account_userId_idx", partitionKey: "userId" },
      {
        indexName: "account_providerId_accountId_idx",
        partitionKey: "providerId",
        sortKey: "accountId"
      }
    ]
  },
  {
    tableName: "verification",
    tableDefinition: {
      attributeDefinitions: [
        { AttributeName: "id", AttributeType: "S" },
        { AttributeName: "identifier", AttributeType: "S" },
        { AttributeName: "createdAt", AttributeType: "S" }
      ],
      keySchema: [{ AttributeName: "id", KeyType: "HASH" }],
      billingMode: "PAY_PER_REQUEST",
      globalSecondaryIndexes: [
        {
          IndexName: "verification_identifier_idx",
          KeySchema: [
            { AttributeName: "identifier", KeyType: "HASH" },
            { AttributeName: "createdAt", KeyType: "RANGE" }
          ],
          Projection: { ProjectionType: "ALL" }
        }
      ]
    },
    indexMappings: [
      {
        indexName: "verification_identifier_idx",
        partitionKey: "identifier",
        sortKey: "createdAt"
      }
    ]
  }
];
export {
  b as DynamoDBAdapterError,
  _n as applyTableSchemas,
  Un as createIndexResolversFromSchemas,
  Gn as createTables,
  Bn as dynamodbAdapter,
  Hn as multiTableSchemas
};
