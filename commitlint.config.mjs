import conventional from "@commitlint/config-conventional";

const [level, applicable, types] = conventional.rules["type-enum"];

export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Merges of branches use "merge: bring in …" headers.
    "type-enum": [level, applicable, [...types, "merge"]],
  },
};
