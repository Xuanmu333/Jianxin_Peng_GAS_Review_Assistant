import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

export async function loadQuestionSeed(modelDataFile) {
  const source = await readFile(modelDataFile, 'utf8');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${source}\n;globalThis.__QUESTION_SEED__={version:QUESTION_LIBRARY_VERSION,categories:QUESTION_CATEGORIES};`, context, {
    filename: modelDataFile,
    timeout: 1000
  });
  const seed = context.__QUESTION_SEED__;
  if (!seed || !Array.isArray(seed.categories)) throw new Error('无法读取内置提问库。');
  return seed.categories.flatMap(category => category.questions.map((question, index) => ({
    questionId: `${category.code}${index + 1}`,
    version: 1,
    categoryCode: category.code,
    categoryName: category.name,
    rule: category.rule,
    confidence: category.confidence,
    text: question,
    status: 'active',
    source: `内置提问库 ${seed.version}`,
    parentQuestionId: ''
  })));
}
