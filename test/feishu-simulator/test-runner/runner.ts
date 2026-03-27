import { FeishuTestClient } from "../feishu-client.js";
import { loadTestFiles } from "./file-loader.js";
import { CsvWriter } from "./csv-writer.js";
import { formatAssert, checkAssertions } from "./asserter.js";
import type { RunnerOptions, ResultRow, TestFile } from "../types.js";

type FileResult = { results: ResultRow[]; errors: string[] };

export async function runTestFiles(opts: RunnerOptions): Promise<{ results: ResultRow[]; errors: string[] }> {
  const testFiles = loadTestFiles(opts.dataDir);

  if (testFiles.length === 0) {
    console.log(`No test JSON files found in: ${opts.dataDir}`);
    return { results: [], errors: [] };
  }

  const concurrency = opts.concurrency ?? 1;

  if (concurrency <= 1) {
    const csv = new CsvWriter(opts.csvOutput);
    const allResults: ResultRow[] = [];
    const allErrors: string[] = [];

    for (const { fileName, data } of testFiles) {
      const { results, errors } = await runSingleFile(fileName, data, opts, csv);
      allResults.push(...results);
      allErrors.push(...errors);
    }

    console.log(`\nCSV report: ${csv.path}`);
    return { results: allResults, errors: allErrors };
  }

  // Parallel
  const tempCsvPaths: string[] = [];
  const tasks = testFiles.map(({ fileName, data }, idx) => {
    const tempCsv = opts.csvOutput.replace(/\.csv$/, `.part-${idx}.csv`);
    tempCsvPaths.push(tempCsv);
    return { fileName, data, csv: new CsvWriter(tempCsv) };
  });

  const allResults: ResultRow[] = [];
  const allErrors: string[] = [];

  let cursor = 0;
  while (cursor < tasks.length) {
    const batch = tasks.slice(cursor, cursor + concurrency);
    const batchResults = await Promise.all(
      batch.map(({ fileName, data, csv }) => runSingleFile(fileName, data, opts, csv)),
    );
    for (const { results, errors } of batchResults) {
      allResults.push(...results);
      allErrors.push(...errors);
    }
    cursor += concurrency;
  }

  CsvWriter.merge(tempCsvPaths, opts.csvOutput);
  console.log(`\nCSV report: ${opts.csvOutput}`);

  return { results: allResults, errors: allErrors };
}

async function runSingleFile(
  fileName: string,
  data: TestFile,
  opts: RunnerOptions,
  csv: CsvWriter,
): Promise<FileResult> {
  const results: ResultRow[] = [];
  const errors: string[] = [];

  console.log(`\n--- ${fileName} ---`);

  function record(row: ResultRow, error?: string) {
    results.push(row);
    csv.append(row);
    if (error) errors.push(error);
  }

  const client = new FeishuTestClient({
    appId: data.appId,
    appSecret: data.appSecret,
    userOpenId: data.userOpenId,
    replyTimeoutMs: opts.replyTimeoutMs,
    pollIntervalMs: opts.pollIntervalMs,
  });

  try {
    await client.init();
  } catch (e) {
    const errMsg = `Init failed: ${(e as Error).message}`;
    console.log(`  ${errMsg}`);
    for (const tc of data.cases) {
      const label = tc.name ?? tc.message.slice(0, 30);
      record({
        file: fileName, name: label, message: tc.message,
        expected: formatAssert(tc.assert), actual: `ERROR: ${errMsg}`,
        passed: false, duration: "-",
      }, `[${fileName}] "${label}": ${errMsg}`);
    }
    return { results, errors };
  }

  for (const [i, tc] of data.cases.entries()) {
    const label = tc.name ?? tc.message.slice(0, 30);
    let caseFailed = false;

    let reply: Awaited<ReturnType<typeof client.send>>;
    try {
      reply = await client.send(tc.message);
    } catch (e) {
      console.log(`  [${i + 1}/${data.cases.length}] FAIL ❌ ${label}`);
      console.log(`    Message: ${tc.message}`);
      console.log(`    Error: ${(e as Error).message}`);
      record({
        file: fileName, name: label, message: tc.message,
        expected: formatAssert(tc.assert), actual: `ERROR: ${(e as Error).message}`,
        passed: false, duration: "-",
      }, `[${fileName}] "${label}": ${(e as Error).message}`);
      if (!opts.continueOnFailure) break;
      continue;
    }

    const failures = checkAssertions(reply.text, tc.assert, reply.reply);

    if (failures.length > 0) {
      caseFailed = true;
      console.log(`  [${i + 1}/${data.cases.length}] FAIL ❌ ${label}`);
      console.log(`    Message:  ${tc.message}`);
      console.log(`    Reply:    ${reply.text}`);
      console.log(`    Failures: ${failures.join("; ")}`);
    } else {
      console.log(`  [${i + 1}/${data.cases.length}] PASS ✅ ${label} (${reply.durationMs}ms)`);
      console.log(`    Reply: ${reply.text}`);
    }

    record({
      file: fileName, name: label, message: tc.message,
      expected: formatAssert(tc.assert),
      actual: failures.length > 0 ? failures.join("; ") : reply.text,
      passed: failures.length === 0,
      duration: `${reply.durationMs}ms`,
    }, failures.length > 0 ? `[${fileName}] "${label}": ${failures.join("; ")}` : undefined);

    if (caseFailed && !opts.continueOnFailure) break;
  }

  return { results, errors };
}
