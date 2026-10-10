import {
  FixtureAnalysisClient,
  recordMockInterventionEvent,
  scenarioById,
  scenarios,
  type DebugScenario,
  type ReplayState,
} from './model.js';

const client = new FixtureAnalysisClient();
const select = document.querySelector<HTMLSelectElement>('#scenario')!;
const runButton = document.querySelector<HTMLButtonElement>('#run')!;
const status = document.querySelector<HTMLElement>('#status')!;
const content = document.querySelector<HTMLElement>('#content')!;

function text(value: string): HTMLSpanElement {
  const element = document.createElement('span');
  element.textContent = value;
  return element;
}

function panel(title: string, body: HTMLElement): HTMLElement {
  const section = document.createElement('section');
  section.className = 'panel';
  const heading = document.createElement('h2');
  heading.textContent = title;
  section.append(heading, body);
  return section;
}

function list(items: readonly string[], empty = 'None'): HTMLUListElement {
  const result = document.createElement('ul');
  for (const item of items) {
    const row = document.createElement('li');
    row.textContent = item;
    result.append(row);
  }
  if (items.length === 0)
    result.append(Object.assign(document.createElement('li'), { textContent: empty }));
  return result;
}

function renderIdle(scenario: DebugScenario): void {
  content.replaceChildren(
    panel(
      'Replay',
      Object.assign(document.createElement('p'), { textContent: scenario.description }),
    ),
  );
}

function render(state: ReplayState): void {
  const scenario = state.scenario;
  status.textContent = state.status.replace('-', ' ').toUpperCase();
  status.dataset.status = state.status;
  const transcript = document.createElement('ol');
  transcript.className = 'transcript';
  for (const utterance of scenario.utterances) {
    const row = document.createElement('li');
    row.append(text(`${utterance.speaker}: `), text(utterance.text));
    transcript.append(row);
  }

  const trigger = document.createElement('div');
  trigger.append(text(`${scenario.trigger.decision} · ${scenario.trigger.reason}`));
  if (scenario.trigger.claim)
    trigger.append(
      Object.assign(document.createElement('p'), { textContent: scenario.trigger.claim }),
    );

  const stages = document.createElement('ol');
  stages.className = 'stages';
  for (const stage of scenario.stages) {
    const row = document.createElement('li');
    row.dataset.status = stage.status;
    row.append(
      text(stage.name),
      Object.assign(document.createElement('small'), { textContent: stage.detail }),
    );
    stages.append(row);
  }

  const evidence = document.createElement('ul');
  for (const item of scenario.evidence) {
    const row = document.createElement('li');
    row.append(
      text(item.detail),
      Object.assign(document.createElement('small'), {
        textContent: `${item.source} · ${item.provenance}`,
      }),
    );
    evidence.append(row);
  }
  if (scenario.evidence.length === 0)
    evidence.append(
      Object.assign(document.createElement('li'), { textContent: 'No evidence collected.' }),
    );

  const verifier = document.createElement('p');
  verifier.append(text(`${scenario.verifier.status}: `), text(scenario.verifier.detail));
  const intervention = document.createElement('div');
  if (scenario.intervention) {
    intervention.append(text(`${scenario.intervention.decision}: ${scenario.intervention.reason}`));
    if (scenario.intervention.decision === 'INTERVENE') {
      const badge = document.createElement('button');
      badge.className = 'intervention-badge';
      badge.dataset.testid = 'intervention-badge';
      badge.type = 'button';
      badge.textContent = '! INTERVENE';
      badge.title = 'Mock details only; Tableau APIs are not invoked.';
      badge.addEventListener('click', () => {
        recordMockInterventionEvent(state);
        render(state);
      });
      intervention.append(badge);
    }
  } else intervention.append(text('No intervention decision.'));

  content.replaceChildren(
    panel('Transcript', transcript),
    panel('Trigger', trigger),
    panel('Analysis Contract', list(scenario.questions, 'No questions created.')),
    panel('Analysis progress', stages),
    panel('Evidence / provenance', evidence),
    panel('Verifier', verifier),
    panel('Intervention', intervention),
    panel('Audit timeline', list(state.audit)),
  );
  if (scenario.error) {
    const error = document.createElement('p');
    error.className = 'error';
    error.textContent = scenario.error;
    content.prepend(error);
  }
}

for (const scenario of scenarios) {
  select.append(
    Object.assign(document.createElement('option'), {
      value: scenario.id,
      textContent: scenario.name,
    }),
  );
}

function selectedScenario(): DebugScenario {
  return scenarioById(select.value);
}

select.addEventListener('change', () => renderIdle(selectedScenario()));
runButton.addEventListener('click', async () => {
  runButton.disabled = true;
  status.textContent = 'RUNNING';
  status.dataset.status = 'running';
  await new Promise((resolve) => setTimeout(resolve, 120));
  render(await client.replay(selectedScenario()));
  runButton.disabled = false;
});

renderIdle(selectedScenario());
