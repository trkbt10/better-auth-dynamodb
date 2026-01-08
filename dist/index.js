import { createAdapterFactory as B } from "@better-auth/core/db/adapter";
import { randomUUID as xe } from "node:crypto";
import { QueryCommand as ne, ScanCommand as ie, BatchGetCommand as be, TransactWriteCommand as ge, PutCommand as ve, DeleteCommand as he, UpdateCommand as Ce } from "@aws-sdk/lib-dynamodb";
import { CreateTableCommand as Ae, waitUntilTableExists as Se, ListTablesCommand as Ie } from "@aws-sdk/client-dynamodb";
class N extends Error {
  constructor(t, n) {
    super(n), this.code = t, this.name = "DynamoDBAdapterError";
  }
}
const re = (e) => e ? e.toLowerCase() : "eq", W = (e) => typeof e == "number" && !Number.isNaN(e), C = (e) => typeof e == "string", Ee = (e, t) => e instanceof Date && t instanceof Date ? e.getTime() - t.getTime() : W(e) && W(t) ? e - t : C(e) && C(t) ? e < t ? -1 : e > t ? 1 : 0 : null, ae = (e) => Array.isArray(e) ? e : [e], P = (e) => {
  const t = e.appendValue(e.value);
  return `${e.fieldToken} ${e.operator} ${t}`;
}, M = (e) => {
  const t = Ee(e.fieldValue, e.value);
  return t === null ? !1 : e.operator === "gt" ? t > 0 : e.operator === "gte" ? t >= 0 : e.operator === "lt" ? t < 0 : t <= 0;
}, J = (e) => {
  const n = ae(e.value).map(
    (r) => e.appendValue(r)
  ), i = `${e.fieldToken} IN (${n.join(", ")})`;
  return e.negate ? `NOT (${i})` : i;
}, H = (e) => {
  const n = ae(e.value).some((i) => i === e.fieldValue);
  return e.negate ? !n : n;
}, we = (e) => {
  const t = e.appendValue(e.value);
  return `contains(${e.fieldToken}, ${t})`;
}, ke = (e) => Array.isArray(e.fieldValue) || C(e.fieldValue) && C(e.value) ? e.fieldValue.includes(e.value) : !1, Te = (e) => {
  const t = e.appendValue(e.value);
  return `begins_with(${e.fieldToken}, ${t})`;
}, Fe = (e) => C(e.fieldValue) && C(e.value) ? e.fieldValue.startsWith(e.value) : !1, Ve = (e) => C(e.fieldValue) && C(e.value) ? e.fieldValue.endsWith(e.value) : !1, pe = {
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
    buildFilterExpression: (e) => P({
      fieldToken: e.fieldToken,
      value: e.value,
      operator: ">",
      appendValue: e.appendValue
    }),
    evaluate: (e) => M({
      fieldValue: e.fieldValue,
      value: e.value,
      operator: "gt"
    })
  },
  gte: {
    requiresClientFilter: !1,
    buildFilterExpression: (e) => P({
      fieldToken: e.fieldToken,
      value: e.value,
      operator: ">=",
      appendValue: e.appendValue
    }),
    evaluate: (e) => M({
      fieldValue: e.fieldValue,
      value: e.value,
      operator: "gte"
    })
  },
  lt: {
    requiresClientFilter: !1,
    buildFilterExpression: (e) => P({
      fieldToken: e.fieldToken,
      value: e.value,
      operator: "<",
      appendValue: e.appendValue
    }),
    evaluate: (e) => M({
      fieldValue: e.fieldValue,
      value: e.value,
      operator: "lt"
    })
  },
  lte: {
    requiresClientFilter: !1,
    buildFilterExpression: (e) => P({
      fieldToken: e.fieldToken,
      value: e.value,
      operator: "<=",
      appendValue: e.appendValue
    }),
    evaluate: (e) => M({
      fieldValue: e.fieldValue,
      value: e.value,
      operator: "lte"
    })
  },
  in: {
    requiresClientFilter: !1,
    buildFilterExpression: (e) => J({
      fieldToken: e.fieldToken,
      value: e.value,
      appendValue: e.appendValue,
      negate: !1
    }),
    evaluate: (e) => H({
      fieldValue: e.fieldValue,
      value: e.value,
      negate: !1
    })
  },
  not_in: {
    requiresClientFilter: !1,
    buildFilterExpression: (e) => J({
      fieldToken: e.fieldToken,
      value: e.value,
      appendValue: e.appendValue,
      negate: !0
    }),
    evaluate: (e) => H({
      fieldValue: e.fieldValue,
      value: e.value,
      negate: !0
    })
  },
  contains: {
    requiresClientFilter: !1,
    buildFilterExpression: we,
    evaluate: ke
  },
  starts_with: {
    requiresClientFilter: !1,
    buildFilterExpression: Te,
    evaluate: Fe
  },
  ends_with: {
    requiresClientFilter: !0,
    buildFilterExpression: void 0,
    evaluate: Ve
  }
}, U = (e) => {
  const t = re(e), n = pe[t];
  if (!n)
    throw new N(
      "UNSUPPORTED_OPERATOR",
      `Unsupported operator: ${e}`
    );
  return n;
}, se = (e) => U(e).requiresClientFilter, $ = (e) => re(e), Ke = (e) => {
  if (!e)
    throw new N(
      "MISSING_WHERE_INPUT",
      "normalizeWhere requires explicit props."
    );
  const { where: t } = e;
  if (!t || t.length === 0)
    return [];
  const n = (i) => i && i.toUpperCase() === "OR" ? "OR" : "AND";
  return t.map((i) => {
    const r = $(
      i.operator
    ), a = n(i.connector);
    return {
      field: i.field,
      operator: r,
      value: i.value,
      connector: a,
      requiresClientFilter: se(i.operator)
    };
  });
}, oe = (e) => e.getFieldName({ model: e.model, field: "id" }), z = (e) => e.where.find(
  (t) => t.operator === e.operator && t.field === e.primaryKeyName
), Pe = (e) => {
  for (const t of e.where) {
    if (t.operator !== "eq")
      continue;
    const n = e.indexNameResolver({
      model: e.model,
      field: t.field
    });
    if (n)
      return { entry: t, indexName: n };
  }
}, Me = (e) => {
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
}, De = (e) => {
  if (!e)
    throw new N(
      "MISSING_STRATEGY_INPUT",
      "resolveBaseStrategy requires explicit props."
    );
  if (e.hasOrConnector)
    return { kind: "scan" };
  const t = oe({
    model: e.model,
    getFieldName: e.getFieldName
  });
  if (z({
    where: e.where,
    primaryKeyName: t,
    operator: "eq"
  }))
    return { kind: "query", key: "pk" };
  const i = Pe({
    where: e.where,
    model: e.model,
    indexNameResolver: e.adapterConfig.indexNameResolver
  });
  if (i)
    return { kind: "query", key: "gsi", indexName: i.indexName };
  const r = Me({
    where: e.where,
    model: e.model,
    indexNameResolver: e.adapterConfig.indexNameResolver
  });
  if (r)
    return {
      kind: "multi-query",
      indexName: r.indexName,
      field: r.entry.field
    };
  const a = z({
    where: e.where,
    primaryKeyName: t,
    operator: "in"
  });
  return a && Array.isArray(a.value) ? { kind: "batch-get" } : { kind: "scan" };
}, le = (e) => {
  if (!e)
    throw new N(
      "MISSING_JOIN_STRATEGY_INPUT",
      "resolveJoinStrategyHint requires explicit props."
    );
  const t = oe({
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
}, Re = (e) => {
  if (!e)
    throw new N(
      "MISSING_JOIN_STRATEGY_INPUT",
      "resolveJoinStrategy requires explicit props."
    );
  const t = le({
    joinField: e.joinField,
    model: e.model,
    getFieldName: e.getFieldName,
    adapterConfig: e.adapterConfig
  });
  return t.kind === "query" && t.key === "pk" && e.baseValues.length > 1 ? { kind: "batch-get" } : t;
}, _e = (e) => {
  if (!e)
    throw new N(
      "MISSING_JOIN_PLAN_INPUT",
      "resolveJoinPlan requires explicit props."
    );
  return !e.join || Object.keys(e.join).length === 0 ? [] : Object.entries(e.join).map(([t, n]) => {
    const i = le({
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
}, qe = (e) => {
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
}, Oe = (e) => {
  if (e.requiresClientFilter || e.requiresClientSort || e.limit === void 0)
    return;
  const t = e.offset ?? 0;
  return e.limit + t;
}, je = (e) => {
  if (e.sortBy)
    return {
      field: e.getFieldName({ model: e.model, field: e.sortBy.field }),
      direction: e.sortBy.direction
    };
}, Le = (e) => {
  if (!e.normalizedSort || e.baseStrategy.kind !== "query" || e.baseStrategy.key !== "gsi" || !e.baseStrategy.indexName || !e.adapterConfig.indexKeySchemaResolver)
    return;
  const t = e.adapterConfig.indexKeySchemaResolver({
    model: e.model,
    indexName: e.baseStrategy.indexName
  });
  if (!(!t || !t.sortKey) && t.sortKey === e.normalizedSort.field)
    return e.normalizedSort;
}, Ue = (e) => !(!e.normalizedSort || e.serverSort), $e = (e) => {
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
  }, n = e.joins.reduce((i, r) => i.selectedFields.has(r.on.from) ? i : (i.selectedFields.add(r.on.from), i.select.push(r.on.from), {
    ...i,
    requiresSelectSupplement: !0
  }), t);
  return {
    select: n.select,
    requiresSelectSupplement: n.requiresSelectSupplement
  };
}, T = (e) => {
  if (!e)
    throw new N(
      "MISSING_QUERY_PLAN_INPUT",
      "buildQueryPlan requires explicit props."
    );
  const t = Ke({ where: e.where }), n = _e({
    join: e.join,
    getFieldName: e.getFieldName,
    adapterConfig: e.adapterConfig
  }), i = $e({
    select: e.select,
    joins: n,
    getFieldName: e.getFieldName,
    model: e.model
  }), r = qe({
    where: t,
    requiresSelectSupplement: i.requiresSelectSupplement
  }), a = De({
    model: e.model,
    where: t,
    getFieldName: e.getFieldName,
    adapterConfig: e.adapterConfig,
    hasOrConnector: r.hasOrConnector
  }), s = n.reduce(
    (x, y) => (x[y.modelKey] = y.strategy, x),
    {}
  ), o = r.hasClientOnlyOperator, l = je({
    sortBy: e.sortBy,
    getFieldName: e.getFieldName,
    model: e.model
  }), d = Le({
    model: e.model,
    baseStrategy: a,
    normalizedSort: l,
    adapterConfig: e.adapterConfig
  }), c = Ue({
    normalizedSort: l,
    serverSort: d
  }), u = {
    baseStrategy: a,
    joinStrategies: s,
    requiresClientFilter: o,
    requiresClientSort: c,
    serverSort: d,
    fetchLimit: Oe({
      limit: e.limit,
      offset: e.offset,
      requiresClientFilter: o,
      requiresClientSort: c
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
    constraints: r
  };
}, Y = (e) => {
  const t = U(e.condition.operator), n = e.item[e.condition.fieldName];
  return t.evaluate({ fieldValue: n, value: e.condition.value });
}, Ge = (e) => e.map((t) => ({
  fieldName: t.field,
  operator: $(t.operator),
  value: t.value,
  connector: t.connector
})), Be = (e) => {
  const { item: t, conditions: n } = e;
  if (n.length === 0)
    return !0;
  const i = n.filter(
    (u) => u.connector === "AND"
  ), r = n.filter(
    (u) => u.connector === "OR"
  ), a = i.map(
    (u) => Y({ item: t, condition: u })
  ), s = r.map(
    (u) => Y({ item: t, condition: u })
  ), o = (u) => u.length === 0 ? !0 : u.every(Boolean), l = (u) => u.length === 0 ? !0 : u.some(Boolean);
  return !(!o(a) || !l(s));
}, We = (e) => {
  if (!e.where || e.where.length === 0)
    return e.items;
  const t = Ge(e.where);
  return e.items.filter((n) => Be({ item: n, conditions: t }));
}, Je = (e) => e.requiresClientFilter ? We({ items: e.items, where: e.where }) : e.items, He = (e) => e === "desc" ? -1 : 1, ze = (e, t) => {
  if (e.length <= 1)
    return e;
  const n = He(t.direction), i = (r) => r == null;
  return [...e].sort((r, a) => {
    const s = r[t.field], o = a[t.field];
    return s === o ? 0 : i(s) ? 1 * n : i(o) ? -1 * n : s > o ? 1 * n : s < o ? -1 * n : 0;
  });
}, Ye = (e, t) => t.sortBy ? ze(e, {
  field: t.sortBy.field,
  direction: t.sortBy.direction
}) : e, Qe = (e) => {
  if (!e.select || e.select.length === 0)
    return e.items;
  const t = e.select.map(
    (n) => e.getFieldName({ model: e.model, field: n })
  );
  return e.items.map((n) => {
    const i = t.reduce(
      (a, s) => (s in n && (a[s] = n[s]), a),
      {}
    ), r = e.joinKeys.reduce(
      (a, s) => (s in n && (a[s] = n[s]), a),
      {}
    );
    return { ...i, ...r };
  });
}, A = (e) => {
  const { model: t, getDefaultModelName: n, config: i } = e, r = n(t);
  if (i.tableNameResolver)
    return i.tableNameResolver(r);
  if (i.tableNamePrefix !== void 0)
    return `${i.tableNamePrefix}${r}`;
  throw new N(
    "MISSING_TABLE_RESOLVER",
    "DynamoDB adapter requires tableNameResolver or tableNamePrefix."
  );
}, Xe = (e, t, n) => {
  const i = `:v${t.index}`;
  return t.index += 1, n[i] = e, i;
}, Ze = (e) => e && e.toUpperCase() === "OR" ? "OR" : "AND", et = (e) => {
  for (const t of e)
    if (se(t.operator))
      return !0;
  return !1;
}, tt = (e) => {
  const t = U(e.operator);
  if (!t.buildFilterExpression)
    throw new N(
      "UNSUPPORTED_OPERATOR",
      "Filter expression builder is missing."
    );
  const n = {
    fieldToken: e.fieldToken,
    value: e.value,
    appendValue: (i) => Xe(i, e.state, e.values)
  };
  return t.buildFilterExpression(n);
}, nt = (e) => {
  const { andExpressions: t, orExpressions: n } = e, i = t.join(" AND "), r = n.join(" OR ");
  if (i && r)
    return `(${i}) AND (${r})`;
  if (i)
    return i;
  if (r)
    return r;
}, w = (e) => {
  const { where: t, model: n, getFieldName: i } = e;
  if (!t || t.length === 0)
    return {
      filterExpression: void 0,
      expressionAttributeNames: {},
      expressionAttributeValues: {},
      requiresClientFilter: !1
    };
  if (et(t))
    return {
      filterExpression: void 0,
      expressionAttributeNames: {},
      expressionAttributeValues: {},
      requiresClientFilter: !0
    };
  const r = {}, a = {}, s = { index: 0 }, o = t.map((u, x) => {
    const y = i({ model: n, field: u.field }), f = `#f${x}`;
    r[f] = y;
    const b = tt({
      fieldToken: f,
      operator: u.operator,
      value: u.value,
      state: s,
      values: a
    });
    return {
      connector: Ze(u.connector),
      expression: b
    };
  }), l = o.filter((u) => u.connector === "AND").map((u) => u.expression), d = o.filter((u) => u.connector === "OR").map((u) => u.expression);
  return {
    filterExpression: nt({
      andExpressions: l,
      orExpressions: d
    }),
    expressionAttributeNames: r,
    expressionAttributeValues: a,
    requiresClientFilter: !1
  };
}, D = (e) => {
  const { model: t, where: n, getFieldName: i, indexNameResolver: r, indexKeySchemaResolver: a } = e;
  if (!n || n.length === 0)
    return null;
  const s = i({ model: t, field: "id" }), o = (m) => m && m.toUpperCase() === "OR" ? "OR" : "AND", l = n.map((m) => ({
    entry: m,
    operator: $(m.operator),
    fieldName: i({ model: t, field: m.field }),
    connector: o(m.connector)
  }));
  if (l.some(
    ({ connector: m }) => m === "OR"
  ))
    return null;
  const c = l.find(
    ({ operator: m, fieldName: E }) => m === "eq" && E === s
  );
  if (c) {
    const m = n.filter(
      (E) => E !== c.entry
    );
    return {
      keyConditionExpression: "#pk = :pk",
      expressionAttributeNames: { "#pk": s },
      expressionAttributeValues: {
        ":pk": c.entry.value
      },
      remainingWhere: m
    };
  }
  const u = l.find(({ operator: m, fieldName: E, entry: O }) => m !== "eq" || !r({ model: t, field: O.field }) ? !1 : E.length > 0);
  if (!u)
    return null;
  const x = r({
    model: t,
    field: u.entry.field
  });
  if (!x)
    return null;
  const y = () => {
    if (a)
      return a({ model: t, indexName: x });
  }, f = (m) => {
    if (m)
      return l.find(
        ({ operator: E, fieldName: O }) => E === "eq" && O === m
      );
  }, b = (m) => m ? "#pk = :pk AND #sk = :sk" : "#pk = :pk", S = (m) => m.sortKey ? {
    "#pk": m.partitionKey,
    "#sk": m.sortKey
  } : { "#pk": m.partitionKey }, I = (m) => m.sortValue === void 0 ? { ":pk": m.partitionValue } : {
    ":pk": m.partitionValue,
    ":sk": m.sortValue
  }, g = y()?.sortKey, v = f(g), V = (m) => {
    if (m)
      return g;
  }, h = (m) => {
    if (m)
      return m.entry.value;
  }, p = n.filter(
    (m) => m !== u.entry && m !== v?.entry
  ), q = b(
    !!v
  ), K = S({
    partitionKey: u.fieldName,
    sortKey: V(v)
  }), ye = I({
    partitionValue: u.entry.value,
    sortValue: h(v)
  });
  return {
    keyConditionExpression: q,
    expressionAttributeNames: K,
    expressionAttributeValues: ye,
    indexName: x,
    remainingWhere: p
  };
}, R = (e, t) => {
  t.filterExpression && (e.FilterExpression = t.filterExpression), Object.keys(t.expressionAttributeNames).length > 0 && (e.ExpressionAttributeNames = t.expressionAttributeNames), Object.keys(t.expressionAttributeValues).length > 0 && (e.ExpressionAttributeValues = t.expressionAttributeValues);
}, _ = async (e) => {
  const t = {
    token: e.initialToken,
    pageCount: 0
  };
  for (; ; ) {
    e.maxPages !== void 0 && t.pageCount >= e.maxPages && e.onMaxPages(), t.pageCount += 1;
    const n = await e.fetchPage(t.token, t.pageCount), i = n.nextToken, r = n.shouldStop === !0;
    if (t.token = i, r || !t.token)
      break;
  }
}, ue = (e, t) => {
  if (e === void 0)
    return;
  const n = e - t;
  return n <= 0 ? 0 : n;
}, j = async (e) => {
  const t = [];
  return await _({
    fetchPage: async (n) => {
      const i = ue(e.limit, t.length);
      if (i === 0)
        return { shouldStop: !0 };
      const r = {
        TableName: e.tableName,
        KeyConditionExpression: e.keyConditionExpression
      };
      e.indexName && (r.IndexName = e.indexName), R(r, {
        filterExpression: e.filterExpression,
        expressionAttributeNames: e.expressionAttributeNames,
        expressionAttributeValues: e.expressionAttributeValues
      }), n && (r.ExclusiveStartKey = n), i !== void 0 && (r.Limit = i), e.scanIndexForward !== void 0 && (r.ScanIndexForward = e.scanIndexForward);
      const a = await e.documentClient.send(
        new ne(r)
      ), s = a.Items ?? [];
      return t.push(...s), { nextToken: a.LastEvaluatedKey ?? void 0 };
    }
  }), t;
}, it = async (e) => {
  const t = { count: 0 };
  return await _({
    fetchPage: async (n) => {
      const i = {
        TableName: e.tableName,
        KeyConditionExpression: e.keyConditionExpression,
        Select: "COUNT"
      };
      e.indexName && (i.IndexName = e.indexName), R(i, {
        filterExpression: e.filterExpression,
        expressionAttributeNames: e.expressionAttributeNames,
        expressionAttributeValues: e.expressionAttributeValues
      }), n && (i.ExclusiveStartKey = n);
      const r = await e.documentClient.send(
        new ne(i)
      );
      return t.count += r.Count ?? 0, { nextToken: r.LastEvaluatedKey ?? void 0 };
    }
  }), t.count;
}, de = async (e) => {
  const t = [];
  return await _({
    maxPages: e.maxPages ?? Number.POSITIVE_INFINITY,
    onMaxPages: () => {
      throw new N(
        "SCAN_PAGE_LIMIT",
        "Scan exceeded the configured page limit."
      );
    },
    fetchPage: async (n) => {
      const i = ue(e.limit, t.length);
      if (i === 0)
        return { shouldStop: !0 };
      const r = {
        TableName: e.tableName
      };
      R(r, {
        filterExpression: e.filterExpression,
        expressionAttributeNames: e.expressionAttributeNames,
        expressionAttributeValues: e.expressionAttributeValues
      }), n && (r.ExclusiveStartKey = n), i !== void 0 && (r.Limit = i);
      const a = await e.documentClient.send(
        new ie(r)
      ), s = a.Items ?? [];
      return t.push(...s), { nextToken: a.LastEvaluatedKey ?? void 0 };
    }
  }), t;
}, rt = async (e) => {
  const t = { count: 0 };
  return await _({
    maxPages: e.maxPages ?? Number.POSITIVE_INFINITY,
    onMaxPages: () => {
      throw new N(
        "SCAN_PAGE_LIMIT",
        "Scan exceeded the configured page limit."
      );
    },
    fetchPage: async (n) => {
      const i = {
        TableName: e.tableName,
        Select: "COUNT"
      };
      R(i, {
        filterExpression: e.filterExpression,
        expressionAttributeNames: e.expressionAttributeNames,
        expressionAttributeValues: e.expressionAttributeValues
      }), n && (i.ExclusiveStartKey = n);
      const r = await e.documentClient.send(
        new ie(i)
      );
      return t.count += r.Count ?? 0, { nextToken: r.LastEvaluatedKey ?? void 0 };
    }
  }), t.count;
}, at = (e, t) => {
  const n = Math.ceil(e.length / t);
  return Array.from(
    { length: n },
    (i, r) => e.slice(r * t, (r + 1) * t)
  );
}, st = (e, t) => t.map((n) => ({ [e]: n })), ot = (e) => {
  const t = e.unprocessed?.[e.tableName]?.Keys;
  return t || [];
}, ce = async (e) => {
  if (e.keys.length === 0)
    return [];
  const t = [], n = at(e.keys, 100), i = 5, r = async (a, s) => {
    if (a.length === 0)
      return [];
    if (s >= i)
      throw new N(
        "BATCH_GET_UNPROCESSED",
        "Failed to resolve unprocessed keys after retries."
      );
    const o = await e.documentClient.send(
      new be({
        RequestItems: {
          [e.tableName]: {
            Keys: a
          }
        }
      })
    ), l = o.Responses?.[e.tableName] ?? [], d = ot({
      unprocessed: o.UnprocessedKeys,
      tableName: e.tableName
    }), c = await r(d, s + 1);
    return [...l, ...c];
  };
  for (const a of n) {
    const s = st(e.keyField, a), o = await r(s, 0);
    t.push(...o);
  }
  return t;
}, lt = (e) => e.relation === "one-to-one" ? 1 : e.limit !== void 0 ? e.limit : 100, ut = (e) => {
  if (!(e.baseValues.length > 1))
    return e.limit;
}, dt = (e) => {
  if (e.adapterConfig.scanMaxPages === void 0)
    throw new N(
      "MISSING_SCAN_LIMIT",
      "Join scan requires scanMaxPages."
    );
  return e.adapterConfig.scanMaxPages;
}, ct = (e) => {
  const t = e.items.map((n) => n[e.field]).filter((n) => n !== void 0);
  return Array.from(new Set(t));
}, mt = (e) => {
  const t = /* @__PURE__ */ new Map();
  for (const n of e.items) {
    const i = n[e.field];
    if (i === void 0)
      continue;
    const r = t.get(i) ?? [];
    t.set(i, [...r, n]);
  }
  return t;
}, ft = (e) => e === "one-to-one" ? null : [], Nt = (e, t) => t === void 0 ? [] : e.get(t) ?? [], Q = (e) => [
  {
    field: e.field,
    operator: e.operator,
    value: e.value,
    connector: "AND"
  }
], yt = async (e) => {
  const t = A({
    model: e.model,
    getDefaultModelName: e.getDefaultModelName,
    config: e.adapterConfig
  }), n = D({
    model: e.model,
    where: e.where,
    getFieldName: e.getFieldName,
    indexNameResolver: e.adapterConfig.indexNameResolver,
    indexKeySchemaResolver: e.adapterConfig.indexKeySchemaResolver
  });
  if (!n)
    throw new N(
      "MISSING_KEY_CONDITION",
      "Join query requires a key condition."
    );
  const i = w({
    model: e.model,
    where: n.remainingWhere,
    getFieldName: e.getFieldName
  });
  return await j({
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
    limit: e.limit
  });
}, xt = async (e) => {
  const t = A({
    model: e.model,
    getDefaultModelName: e.getDefaultModelName,
    config: e.adapterConfig
  }), n = w({
    model: e.model,
    where: e.where,
    getFieldName: e.getFieldName
  });
  return await de({
    documentClient: e.documentClient,
    tableName: t,
    filterExpression: n.filterExpression,
    expressionAttributeNames: n.expressionAttributeNames,
    expressionAttributeValues: n.expressionAttributeValues,
    limit: e.limit,
    maxPages: e.maxPages
  });
}, bt = async (e) => {
  if (!e)
    throw new N(
      "MISSING_JOIN_EXECUTION_INPUT",
      "executeJoin requires explicit props."
    );
  const t = ct({
    items: e.baseItems,
    field: e.join.on.from
  });
  if (t.length === 0)
    return e.baseItems.map((l) => ({
      ...l,
      [e.join.modelKey]: ft(e.join.relation)
    }));
  const n = Re({
    joinField: e.join.on.to,
    model: e.join.model,
    baseValues: t,
    getFieldName: e.getFieldName,
    adapterConfig: e.adapterConfig
  }), i = lt({
    relation: e.join.relation,
    limit: e.join.limit
  }), a = await (async () => {
    if (n.kind === "batch-get") {
      const u = e.join.on.to;
      return ce({
        documentClient: e.documentClient,
        tableName: A({
          model: e.join.model,
          getDefaultModelName: e.getDefaultModelName,
          config: e.adapterConfig
        }),
        keyField: u,
        keys: t
      });
    }
    if (n.kind === "query") {
      const u = Promise.resolve([]);
      return t.reduce(async (x, y) => {
        const f = await x, b = Q({
          field: e.join.on.to,
          operator: "eq",
          value: y
        }), S = await yt({
          documentClient: e.documentClient,
          adapterConfig: e.adapterConfig,
          model: e.join.model,
          where: b,
          limit: i,
          getFieldName: e.getFieldName,
          getDefaultModelName: e.getDefaultModelName
        });
        return [...f, ...S];
      }, u);
    }
    const l = Q({
      field: e.join.on.to,
      operator: "in",
      value: t
    }), d = dt({ adapterConfig: e.adapterConfig }), c = ut({
      limit: i,
      baseValues: t
    });
    return xt({
      documentClient: e.documentClient,
      adapterConfig: e.adapterConfig,
      model: e.join.model,
      where: l,
      limit: c,
      maxPages: d,
      getFieldName: e.getFieldName,
      getDefaultModelName: e.getDefaultModelName
    });
  })(), s = mt({
    items: a,
    field: e.join.on.to
  }), o = (l) => e.join.relation === "one-to-one" ? l[0] ?? null : l.slice(0, i);
  return e.baseItems.map((l) => {
    const d = l[e.join.on.from], c = Nt(s, d), u = o(c);
    return {
      ...l,
      [e.join.modelKey]: u
    };
  });
}, gt = (e) => e.strategy.kind === "batch-get" ? !0 : e.requiresClientFilter, vt = (e) => {
  if (e.serverSort)
    return e.serverSort.direction === "asc";
}, ht = (e) => e.strategy.kind !== "query" ? e.keyConditionIndex : e.strategy.key === "gsi" ? e.strategy.indexName : e.keyConditionIndex, Ct = (e) => e.serverSort ? e.items : Ye(e.items, { sortBy: e.sort }), At = (e) => {
  if (e.adapterConfig.scanMaxPages === void 0)
    throw new N(
      "MISSING_SCAN_LIMIT",
      "Scan execution requires scanMaxPages."
    );
  return e.adapterConfig.scanMaxPages;
}, St = (e) => e.map((t) => ({
  field: t.field,
  operator: t.operator,
  value: t.value,
  connector: t.connector
})), It = (e) => {
  const t = e.where.find(
    (n) => n.field === e.primaryKeyName && n.operator === "in"
  );
  return t ? Array.isArray(t.value) ? t.value : [] : [];
}, Et = async (e) => {
  const t = St(e.plan.base.where), n = A({
    model: e.plan.base.model,
    getDefaultModelName: e.getDefaultModelName,
    config: e.adapterConfig
  }), i = e.plan.execution.baseStrategy;
  if (i.kind === "batch-get") {
    const s = e.getFieldName({
      model: e.plan.base.model,
      field: "id"
    }), o = It({
      where: e.plan.base.where,
      primaryKeyName: s
    });
    return o.length === 0 ? [] : ce({
      documentClient: e.documentClient,
      tableName: n,
      keyField: s,
      keys: o
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
    const o = s.value, l = e.plan.execution.fetchLimit, d = e.plan.base.model;
    return (await Promise.all(
      o.map(async (u) => {
        const x = t.map((b) => b.field === i.field && b.operator === "in" ? {
          ...b,
          operator: "eq",
          value: u
        } : b), y = D({
          model: d,
          where: x,
          getFieldName: e.getFieldName,
          indexNameResolver: e.adapterConfig.indexNameResolver,
          indexKeySchemaResolver: e.adapterConfig.indexKeySchemaResolver
        });
        if (!y)
          return [];
        const f = w({
          model: d,
          where: y.remainingWhere,
          getFieldName: e.getFieldName
        });
        return await j({
          documentClient: e.documentClient,
          tableName: n,
          indexName: y.indexName ?? i.indexName,
          keyConditionExpression: y.keyConditionExpression,
          filterExpression: f.filterExpression,
          expressionAttributeNames: {
            ...y.expressionAttributeNames,
            ...f.expressionAttributeNames
          },
          expressionAttributeValues: {
            ...y.expressionAttributeValues,
            ...f.expressionAttributeValues
          },
          limit: l
        });
      })
    )).flat();
  }
  if (i.kind === "query") {
    const s = D({
      model: e.plan.base.model,
      where: t,
      getFieldName: e.getFieldName,
      indexNameResolver: e.adapterConfig.indexNameResolver,
      indexKeySchemaResolver: e.adapterConfig.indexKeySchemaResolver
    });
    if (!s)
      throw new N(
        "MISSING_KEY_CONDITION",
        "Query strategy requires a key condition."
      );
    const o = w({
      model: e.plan.base.model,
      where: s.remainingWhere,
      getFieldName: e.getFieldName
    }), l = ht({
      strategy: i,
      keyConditionIndex: s.indexName
    }), d = vt({
      serverSort: e.plan.execution.serverSort
    });
    return await j({
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
      scanIndexForward: d
    });
  }
  const r = w({
    model: e.plan.base.model,
    where: t,
    getFieldName: e.getFieldName
  }), a = At({ adapterConfig: e.adapterConfig });
  return await de({
    documentClient: e.documentClient,
    tableName: n,
    filterExpression: r.filterExpression,
    expressionAttributeNames: r.expressionAttributeNames,
    expressionAttributeValues: r.expressionAttributeValues,
    limit: e.plan.execution.fetchLimit,
    maxPages: a
  });
}, wt = (e) => {
  const t = e.offset ?? 0;
  return e.limit === void 0 ? e.items.slice(t) : e.items.slice(t, t + e.limit);
}, k = (e) => {
  if (!e)
    throw new N(
      "MISSING_EXECUTOR_INPUT",
      "createQueryPlanExecutor requires explicit props."
    );
  return async (t) => {
    const n = await Et({
      plan: t,
      documentClient: e.documentClient,
      adapterConfig: e.adapterConfig,
      getFieldName: e.getFieldName,
      getDefaultModelName: e.getDefaultModelName
    }), i = gt({
      strategy: t.execution.baseStrategy,
      requiresClientFilter: t.execution.requiresClientFilter
    }), r = Je({
      items: n,
      where: t.base.where,
      requiresClientFilter: i
    }), a = Ct({
      items: r,
      serverSort: t.execution.serverSort,
      sort: t.base.sort
    }), s = wt({
      items: a,
      offset: t.base.offset,
      limit: t.base.limit
    }), l = await t.joins.reduce(
      async (u, x) => {
        const y = await u;
        return bt({
          baseItems: y,
          join: x,
          documentClient: e.documentClient,
          adapterConfig: e.adapterConfig,
          getFieldName: e.getFieldName,
          getDefaultModelName: e.getDefaultModelName
        });
      },
      Promise.resolve(s)
    ), d = t.joins.map((u) => u.modelKey);
    return Qe({
      items: l,
      model: t.base.model,
      select: t.base.select,
      joinKeys: d,
      getFieldName: e.getFieldName
    });
  };
}, kt = (e, t) => {
  const { documentClient: n } = e, { adapterConfig: i, getFieldName: r, getDefaultModelName: a } = t, s = () => {
    if (i.scanMaxPages === void 0)
      throw new N(
        "MISSING_SCAN_LIMIT",
        "Count scan requires scanMaxPages."
      );
    return i.scanMaxPages;
  };
  return async ({
    model: o,
    where: l
  }) => {
    const d = T({
      model: o,
      where: l,
      select: void 0,
      sortBy: void 0,
      limit: void 0,
      offset: void 0,
      join: void 0,
      getFieldName: r,
      adapterConfig: i
    });
    if (d.execution.requiresClientFilter)
      return (await k({
        documentClient: n,
        adapterConfig: i,
        getFieldName: r,
        getDefaultModelName: a
      })(d)).length;
    if (d.execution.baseStrategy.kind === "batch-get")
      return (await k({
        documentClient: n,
        adapterConfig: i,
        getFieldName: r,
        getDefaultModelName: a
      })(d)).length;
    const c = A({
      model: o,
      getDefaultModelName: a,
      config: i
    }), u = d.base.where.map((f) => ({
      field: f.field,
      operator: f.operator,
      value: f.value,
      connector: f.connector
    }));
    if (d.execution.baseStrategy.kind === "query") {
      const f = D({
        model: o,
        where: u,
        getFieldName: r,
        indexNameResolver: i.indexNameResolver,
        indexKeySchemaResolver: i.indexKeySchemaResolver
      });
      if (!f)
        throw new N(
          "MISSING_KEY_CONDITION",
          "Count query requires a key condition."
        );
      const b = w({
        model: o,
        where: f.remainingWhere,
        getFieldName: r
      });
      return it({
        documentClient: n,
        tableName: c,
        indexName: f.indexName,
        keyConditionExpression: f.keyConditionExpression,
        filterExpression: b.filterExpression,
        expressionAttributeNames: {
          ...f.expressionAttributeNames,
          ...b.expressionAttributeNames
        },
        expressionAttributeValues: {
          ...f.expressionAttributeValues,
          ...b.expressionAttributeValues
        }
      });
    }
    const x = w({
      model: o,
      where: u,
      getFieldName: r
    }), y = s();
    return rt({
      documentClient: n,
      tableName: c,
      filterExpression: x.filterExpression,
      expressionAttributeNames: x.expressionAttributeNames,
      expressionAttributeValues: x.expressionAttributeValues,
      maxPages: y
    });
  };
}, Tt = () => ({
  operations: []
}), G = (e, t) => {
  if (e.operations.length >= 25)
    throw new N(
      "TRANSACTION_LIMIT",
      "DynamoDB transactions are limited to 25 operations."
    );
  e.operations.push(t);
}, Ft = (e) => e.kind === "put" ? {
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
}, Vt = async (e) => {
  const { documentClient: t, state: n } = e;
  if (n.operations.length === 0)
    return;
  const i = n.operations.map(
    (r) => Ft(r)
  );
  await t.send(
    new ge({
      TransactItems: i
    })
  );
}, pt = (e, t) => {
  const { documentClient: n } = e, { adapterConfig: i, getDefaultModelName: r, transactionState: a } = t, s = (o) => A({
    model: o,
    getDefaultModelName: r,
    config: i
  });
  return async ({
    model: o,
    data: l
  }) => {
    const d = s(o);
    return a ? (G(a, {
      kind: "put",
      tableName: d,
      item: l
    }), l) : (await n.send(
      new ve({
        TableName: d,
        Item: l
      })
    ), l);
  };
}, me = (e) => {
  const { item: t, keyField: n } = e;
  if (!(n in t))
    throw new N(
      "MISSING_PRIMARY_KEY",
      `Item is missing primary key field "${n}".`
    );
  return { [n]: t[n] };
}, fe = (e, t) => {
  const { documentClient: n } = e, {
    adapterConfig: i,
    getFieldName: r,
    getDefaultModelName: a,
    transactionState: s
  } = t, o = k({
    documentClient: n,
    adapterConfig: i,
    getFieldName: r,
    getDefaultModelName: a
  }), l = (c) => A({
    model: c,
    getDefaultModelName: a,
    config: i
  }), d = (c) => r({ model: c, field: "id" });
  return async ({ model: c, where: u, limit: x }) => {
    const y = l(c), f = T({
      model: c,
      where: u,
      select: void 0,
      sortBy: void 0,
      limit: x,
      offset: void 0,
      join: void 0,
      getFieldName: r,
      adapterConfig: i
    }), b = await o(f);
    if (b.length === 0)
      return 0;
    const S = d(c), I = { deleted: 0 };
    for (const F of b) {
      const g = me({
        item: F,
        keyField: S
      });
      s ? G(s, {
        kind: "delete",
        tableName: y,
        key: g
      }) : await n.send(
        new he({
          TableName: y,
          Key: g
        })
      ), I.deleted += 1;
    }
    return I.deleted;
  };
}, Kt = (e, t) => {
  const n = fe(e, t);
  return async ({ model: i, where: r }) => n({ model: i, where: r });
}, Pt = (e, t) => {
  const n = fe(e, t);
  return async ({
    model: i,
    where: r
  }) => {
    await n({ model: i, where: r, limit: 1 });
  };
}, Mt = (e, t) => {
  const { documentClient: n } = e, {
    adapterConfig: i,
    getFieldName: r,
    getDefaultModelName: a
  } = t, s = k({
    documentClient: n,
    adapterConfig: i,
    getFieldName: r,
    getDefaultModelName: a
  });
  return async ({
    model: o,
    where: l,
    limit: d,
    sortBy: c,
    offset: u,
    join: x
  }) => {
    const y = T({
      model: o,
      where: l,
      select: void 0,
      sortBy: c,
      limit: d,
      offset: u,
      join: x,
      getFieldName: r,
      adapterConfig: i
    });
    return s(y);
  };
}, Dt = (e, t) => {
  const n = Mt(e, t);
  return async (i) => await n(i);
}, Rt = (e, t) => {
  const n = k({
    documentClient: e.documentClient,
    adapterConfig: t.adapterConfig,
    getFieldName: t.getFieldName,
    getDefaultModelName: t.getDefaultModelName
  });
  return async ({
    model: i,
    where: r,
    select: a,
    join: s
  }) => {
    const o = T({
      model: i,
      where: r,
      select: a,
      sortBy: void 0,
      limit: 1,
      offset: 0,
      join: s,
      getFieldName: t.getFieldName,
      adapterConfig: t.adapterConfig
    }), l = await n(o);
    return l.length === 0 ? null : l[0];
  };
}, X = (e) => e !== null && typeof e == "object" && !Array.isArray(e), L = (e, t, n) => {
  if (Object.is(t, n))
    return [];
  if (typeof t != typeof n)
    return [{ path: e, prev: t, next: n }];
  if (Array.isArray(t) && Array.isArray(n)) {
    const i = Math.max(t.length, n.length);
    return Array.from({ length: i }, (r, a) => {
      const s = t[a], o = n[a];
      return L([...e, a], s, o);
    }).flat();
  }
  if (X(t) && X(n)) {
    const i = /* @__PURE__ */ new Set([...Object.keys(t), ...Object.keys(n)]);
    return Array.from(i).flatMap(
      (r) => L([...e, r], t[r], n[r])
    );
  }
  return [{ path: e, prev: t, next: n }];
}, Z = (e) => {
  const t = /* @__PURE__ */ new Map(), n = { value: 0 };
  return (i) => {
    const r = t.get(i);
    if (r)
      return r;
    const a = `${e}${n.value}`;
    return n.value += 1, t.set(i, a), a;
  };
}, _t = (e, t) => typeof e < "u" && typeof t > "u", qt = (e, t) => typeof e == "number" && typeof t == "number", Ot = (e, t) => typeof e != typeof t, jt = (e, t) => typeof e == typeof t, ee = (e) => {
  if (typeof e == "string")
    return e;
  try {
    return JSON.stringify(e);
  } catch {
    throw new N(
      "INVALID_UPDATE",
      "Failed to serialize update value."
    );
  }
}, Lt = (e) => {
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
  ), i = (o) => o === "" ? "" : ".", r = e.path.reduce((o, l) => {
    if (typeof l == "number")
      return `${o}[${l}]`;
    const d = i(o);
    return `${o}${d}#${e.makeNameKey(l)}`;
  }, ""), a = n.map((o, l) => [
    `#${o}`,
    t[l].toString()
  ]), s = Object.fromEntries(a);
  if (_t(e.prev, e.next))
    return {
      kind: "remove",
      expression: r,
      attributeNames: s,
      attributeValues: {}
    };
  if (qt(e.prev, e.next)) {
    const o = e.next - e.prev, l = e.makeValueKey(ee(o));
    return {
      kind: "add",
      expression: `${r} :${l}`,
      attributeNames: s,
      attributeValues: {
        [`:${l}`]: o
      }
    };
  }
  if (jt(e.prev, e.next) || Ot(e.prev, e.next)) {
    const o = e.makeValueKey(ee(e.next));
    return {
      kind: "set",
      expression: `${r} = :${o}`,
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
}, Ut = (e) => {
  const t = e.reduce(
    (i, r) => {
      const a = i[r.kind] ?? [];
      return i[r.kind] = [...a, r], i;
    },
    {}
  ), n = Object.entries(t).reduce(
    (i, [r, a]) => {
      if (r === "noop")
        return i;
      const s = a.map((o) => o.expression).join(",");
      return {
        updateExpression: [...i.updateExpression, `${r.toUpperCase()} ${s}`],
        attributeNames: a.reduce(
          (o, l) => ({ ...o, ...l.attributeNames }),
          i.attributeNames
        ),
        attributeValues: a.reduce(
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
}, $t = (e) => {
  if (!e)
    throw new N(
      "INVALID_UPDATE",
      "Patch update requires explicit prev/next."
    );
  const t = L([], e.prev, e.next);
  if (t.length === 0)
    throw new N(
      "INVALID_UPDATE",
      "Update payload must include at least one defined value."
    );
  const n = Z("a"), i = Z("v"), r = t.map(
    (s) => Lt({
      ...s,
      makeNameKey: n,
      makeValueKey: i
    })
  ), a = Ut(r);
  if (!a.updateExpression)
    throw new N(
      "INVALID_UPDATE",
      "Update payload must include at least one defined value."
    );
  return {
    updateExpression: a.updateExpression,
    expressionAttributeNames: a.attributeNames,
    expressionAttributeValues: a.attributeValues
  };
}, Gt = (e, t) => Object.entries(t).reduce(
  (n, [i, r]) => ({ ...n, [i]: r }),
  { ...e }
), Bt = (e) => Object.entries(e).reduce(
  (n, [i, r]) => r === void 0 ? n : { ...n, [i]: r },
  {}
), Wt = (e) => e ? { ReturnValues: "ALL_NEW" } : {}, Ne = (e, t) => {
  const { documentClient: n } = e, {
    adapterConfig: i,
    getFieldName: r,
    getDefaultModelName: a,
    transactionState: s
  } = t, o = k({
    documentClient: n,
    adapterConfig: i,
    getFieldName: r,
    getDefaultModelName: a
  }), l = (c) => A({
    model: c,
    getDefaultModelName: a,
    config: i
  }), d = (c) => r({ model: c, field: "id" });
  return async ({
    model: c,
    where: u,
    update: x,
    limit: y,
    returnUpdatedItems: f
  }) => {
    const b = l(c), S = T({
      model: c,
      where: u,
      select: void 0,
      sortBy: void 0,
      limit: y,
      offset: void 0,
      join: void 0,
      getFieldName: r,
      adapterConfig: i
    }), I = await o(S);
    if (I.length === 0)
      return { updatedCount: 0, updatedItems: [] };
    const F = d(c), g = {
      updatedCount: 0,
      updatedItems: []
    };
    for (const v of I) {
      const V = Gt(
        v,
        x
      ), h = $t({
        prev: v,
        next: V
      }), p = me({
        item: v,
        keyField: F
      });
      if (s)
        G(s, {
          kind: "update",
          tableName: b,
          key: p,
          updateExpression: h.updateExpression,
          expressionAttributeNames: h.expressionAttributeNames,
          expressionAttributeValues: h.expressionAttributeValues
        }), f && g.updatedItems.push(
          Bt(V)
        );
      else {
        const q = {
          TableName: b,
          Key: p,
          UpdateExpression: h.updateExpression,
          ExpressionAttributeNames: h.expressionAttributeNames,
          ExpressionAttributeValues: h.expressionAttributeValues,
          ...Wt(f)
        }, K = await n.send(
          new Ce(q)
        );
        f && K.Attributes && g.updatedItems.push(
          K.Attributes
        );
      }
      g.updatedCount += 1;
    }
    return g;
  };
}, Jt = (e, t) => {
  const n = Ne(e, t);
  return async ({
    model: i,
    where: r,
    update: a
  }) => (await n({
    model: i,
    where: r,
    update: a,
    returnUpdatedItems: !1
  })).updatedCount;
}, Ht = (e, t) => {
  const n = Ne(e, t);
  return async ({
    model: i,
    where: r,
    update: a
  }) => {
    const s = await n({
      model: i,
      where: r,
      update: a,
      limit: 1,
      returnUpdatedItems: !0
    });
    return s.updatedItems.length === 0 ? null : s.updatedItems[0];
  };
}, zt = (e) => {
  if (!e)
    throw new N("MISSING_CLIENT", "DynamoDB adapter requires a DynamoDBDocumentClient instance.");
  return e;
}, te = (e) => {
  const { documentClient: t, adapterConfig: n, transactionState: i } = e;
  return ({ getFieldName: r, getDefaultModelName: a }) => {
    const s = { documentClient: t }, o = {
      adapterConfig: n,
      getFieldName: r,
      getDefaultModelName: a
    }, l = o, d = {
      ...o,
      transactionState: i
    }, c = {
      ...o,
      transactionState: i
    };
    return {
      create: pt(s, {
        adapterConfig: n,
        getDefaultModelName: a,
        transactionState: i
      }),
      findOne: Rt(s, o),
      findMany: Dt(s, o),
      count: kt(s, l),
      update: Ht(s, d),
      updateMany: Jt(s, d),
      delete: Pt(s, c),
      deleteMany: Kt(s, c)
    };
  };
}, nn = (e) => {
  if (!e.indexNameResolver)
    throw new N(
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
    indexNameResolver: e.indexNameResolver,
    indexKeySchemaResolver: e.indexKeySchemaResolver,
    transaction: e.transaction ?? !1
  }, n = zt(t.documentClient), i = { value: null }, r = {
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
      customIdGenerator: e.customIdGenerator ?? (() => xe()),
      disableIdGeneration: e.disableIdGeneration,
      mapKeysTransformInput: e.mapKeysTransformInput,
      mapKeysTransformOutput: e.mapKeysTransformOutput,
      customTransformInput: e.customTransformInput,
      customTransformOutput: e.customTransformOutput,
      transaction: !1
    },
    adapter: te({
      documentClient: n,
      adapterConfig: t
    })
  };
  t.transaction && (r.config.transaction = async (s) => {
    const o = i.value;
    if (!o)
      throw new N("MISSING_CLIENT", "DynamoDB adapter options are not initialized.");
    const l = Tt(), d = B({
      config: { ...r.config, transaction: !1 },
      adapter: te({
        documentClient: n,
        adapterConfig: t,
        transactionState: l
      })
    })(o), c = await s(d);
    return await Vt({ documentClient: n, state: l }), c;
  });
  const a = B(r);
  return (s) => (i.value = s, a(s));
}, Yt = async (e) => {
  const t = [], n = { lastEvaluatedTableName: void 0 };
  for (; ; ) {
    const i = await e.send(
      new Ie({
        ExclusiveStartTableName: n.lastEvaluatedTableName
      })
    );
    if (t.push(...i.TableNames ?? []), n.lastEvaluatedTableName = i.LastEvaluatedTableName, !n.lastEvaluatedTableName)
      break;
  }
  return t;
}, rn = async (e) => {
  if (!e.client)
    throw new N("MISSING_CLIENT", "DynamoDB createTables requires a DynamoDBClient instance.");
  const t = await Yt(e.client), n = e.wait ?? { maxWaitTime: 60, minDelay: 2 }, i = [];
  for (const r of e.tables) {
    if (t.includes(r.tableName))
      continue;
    const a = r.tableDefinition;
    await e.client.send(
      new Ae({
        TableName: r.tableName,
        AttributeDefinitions: a.attributeDefinitions,
        KeySchema: a.keySchema,
        BillingMode: a.billingMode,
        GlobalSecondaryIndexes: a.globalSecondaryIndexes
      })
    ), await Se({ client: e.client, ...n }, { TableName: r.tableName }), i.push(r.tableName);
  }
  return i;
}, an = (e) => {
  if (e.length === 0)
    throw new Error("index resolver creation requires table schemas.");
  const t = /* @__PURE__ */ new Map(), n = /* @__PURE__ */ new Map();
  for (const i of e)
    for (const r of i.indexMappings) {
      const a = `${i.tableName}:${r.partitionKey}`;
      if (t.has(a))
        throw new Error(
          `Duplicate partition key mapping for ${i.tableName}.${r.partitionKey}.`
        );
      t.set(a, r);
      const s = `${i.tableName}:${r.indexName}`;
      if (n.has(s))
        throw new Error(
          `Duplicate index name mapping for ${i.tableName}.${r.indexName}.`
        );
      n.set(s, r);
    }
  return {
    indexNameResolver: ({ model: i, field: r }) => t.get(`${i}:${r}`)?.indexName,
    indexKeySchemaResolver: ({ model: i, indexName: r }) => {
      const a = n.get(`${i}:${r}`);
      if (a)
        return {
          partitionKey: a.partitionKey,
          sortKey: a.sortKey
        };
    }
  };
}, sn = [
  {
    tableName: "user",
    tableDefinition: {
      attributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
      keySchema: [{ AttributeName: "id", KeyType: "HASH" }],
      billingMode: "PAY_PER_REQUEST"
    },
    indexMappings: []
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
  N as DynamoDBAdapterError,
  an as createIndexResolversFromSchemas,
  rn as createTables,
  nn as dynamodbAdapter,
  sn as multiTableSchemas
};
