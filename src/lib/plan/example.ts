import type { DistributedPlan } from "./types";

/**
 * The example from the Trino docs, verbatim:
 * https://trino.io/docs/current/sql/explain.html#explain-type-distributed-format-json
 *
 *   EXPLAIN (TYPE DISTRIBUTED, FORMAT JSON) SELECT regionkey, count(*) FROM nation GROUP BY 1
 *
 * Note that only the table scan is costed; every other node reports "NaN".
 */
export const EXAMPLE_PLAN: DistributedPlan = {
  "0": {
    id: "9",
    name: "Output",
    descriptor: { columnNames: "[regionkey, _col1]" },
    outputs: [
      { symbol: "regionkey", type: "bigint" },
      { symbol: "count", type: "bigint" }
    ],
    details: ["_col1 := count"],
    estimates: [
      {
        outputRowCount: "NaN",
        outputSizeInBytes: "NaN",
        cpuCost: "NaN",
        memoryCost: "NaN",
        networkCost: "NaN"
      }
    ],
    children: [
      {
        id: "145",
        name: "RemoteSource",
        descriptor: { sourceFragmentIds: "[1]" },
        outputs: [
          { symbol: "regionkey", type: "bigint" },
          { symbol: "count", type: "bigint" }
        ],
        details: [],
        estimates: [],
        children: []
      }
    ]
  },
  "1": {
    id: "4",
    name: "Aggregate",
    descriptor: { type: "FINAL", keys: "[regionkey]", hash: "[]" },
    outputs: [
      { symbol: "regionkey", type: "bigint" },
      { symbol: "count", type: "bigint" }
    ],
    details: ['count := count("count_0")'],
    estimates: [
      {
        outputRowCount: "NaN",
        outputSizeInBytes: "NaN",
        cpuCost: "NaN",
        memoryCost: "NaN",
        networkCost: "NaN"
      }
    ],
    children: [
      {
        id: "194",
        name: "LocalExchange",
        descriptor: {
          partitioning: "SINGLE",
          isReplicateNullsAndAny: "",
          hashColumn: "[]",
          arguments: "[]"
        },
        outputs: [
          { symbol: "regionkey", type: "bigint" },
          { symbol: "count_0", type: "bigint" }
        ],
        details: [],
        estimates: [
          {
            outputRowCount: "NaN",
            outputSizeInBytes: "NaN",
            cpuCost: "NaN",
            memoryCost: "NaN",
            networkCost: "NaN"
          }
        ],
        children: [
          {
            id: "227",
            name: "Project",
            descriptor: {},
            outputs: [
              { symbol: "regionkey", type: "bigint" },
              { symbol: "count_0", type: "bigint" }
            ],
            details: [],
            estimates: [
              {
                outputRowCount: "NaN",
                outputSizeInBytes: "NaN",
                cpuCost: "NaN",
                memoryCost: "NaN",
                networkCost: "NaN"
              }
            ],
            children: [
              {
                id: "200",
                name: "RemoteSource",
                descriptor: { sourceFragmentIds: "[2]" },
                outputs: [
                  { symbol: "regionkey", type: "bigint" },
                  { symbol: "count_0", type: "bigint" },
                  { symbol: "$hashvalue", type: "bigint" }
                ],
                details: [],
                estimates: [],
                children: []
              }
            ]
          }
        ]
      }
    ]
  },
  "2": {
    id: "226",
    name: "Project",
    descriptor: {},
    outputs: [
      { symbol: "regionkey", type: "bigint" },
      { symbol: "count_0", type: "bigint" },
      { symbol: "$hashvalue_1", type: "bigint" }
    ],
    details: [
      '$hashvalue_1 := combine_hash(bigint \'0\', COALESCE("$operator$hash_code"("regionkey"), 0))'
    ],
    estimates: [
      {
        outputRowCount: "NaN",
        outputSizeInBytes: "NaN",
        cpuCost: "NaN",
        memoryCost: "NaN",
        networkCost: "NaN"
      }
    ],
    children: [
      {
        id: "198",
        name: "Aggregate",
        descriptor: { type: "PARTIAL", keys: "[regionkey]", hash: "[]" },
        outputs: [
          { symbol: "regionkey", type: "bigint" },
          { symbol: "count_0", type: "bigint" }
        ],
        details: ["count_0 := count(*)"],
        estimates: [],
        children: [
          {
            id: "0",
            name: "TableScan",
            descriptor: { table: "tpch:tiny:nation" },
            outputs: [{ symbol: "regionkey", type: "bigint" }],
            details: ["regionkey := tpch:regionkey"],
            estimates: [
              {
                outputRowCount: 25.0,
                outputSizeInBytes: 225.0,
                cpuCost: 225.0,
                memoryCost: 0.0,
                networkCost: 0.0
              }
            ],
            children: []
          }
        ]
      }
    ]
  }
};
