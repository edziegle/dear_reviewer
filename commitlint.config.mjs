import conventional from "@commitlint/config-conventional";

const [level, applicable, types] = conventional.rules["type-enum"];

export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Merges of branches use "merge: bring in …" headers.
    "type-enum": [level, applicable, [...types, "merge"]],
    // Messages feed the changelog, so wrapping them to a width would only add line breaks there.
    "header-max-length": [0],
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
  },
};
