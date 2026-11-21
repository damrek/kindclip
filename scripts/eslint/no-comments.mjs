import path from "node:path";
import { compareCount, extractComments, loadBaseline } from "../comments.mjs";

const root = process.cwd();

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Comments are banned; the file baseline may only shrink",
    },
    schema: [],
    messages: {
      exceeded:
        "{{count}} comments in this file; the baseline allows {{cap}}. Delete a comment instead of adding one.",
      lower:
        "The baseline can be lowered from {{cap}} to {{count}}. Run `npm run comments:update`.",
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    const relative = path.relative(root, filename).split(path.sep).join("/");
    const baseline = loadBaseline(root);
    const cap = baseline.files?.[relative] ?? 0;
    const comments = extractComments(context.sourceCode.text, path.extname(filename));
    const plain = comments.filter((comment) => !comment.directive);
    const { count, excess, lower } = compareCount(plain, cap);

    if (excess > 0) {
      const first = plain[cap] ?? plain[plain.length - 1];
      context.report({
        loc: { line: first?.startLine ?? 1, column: 0 },
        messageId: "exceeded",
        data: { count, cap },
      });
    }

    if (lower > 0) {
      context.report({
        loc: { line: 1, column: 0 },
        messageId: "lower",
        data: { count, cap },
      });
    }

    return {};
  },
};
