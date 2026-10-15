import {
  HttpAnalysisClient,
  scenarioById,
  scenarios,
  type DebugScenario,
  type ReplayState,
} from './model.js';
import { initializeTableauHost } from './host-adapter.js';
import {
  MockViewActionAdapter,
  TableauViewActionAdapter,
  ViewActionController,
  approvedViewActionConfigurationFromGlobal,
  tableauViewActionApiFromGlobal,
  type ViewActionPolicy,
  type ViewActionProposal,
  type ViewActionAdapter,
  isViewActionEligible,
} from './view-actions.js';

const client = new HttpAnalysisClient();
const select = document.querySelector<HTMLSelectElement>('#scenario')!;
const runButton = document.querySelector<HTMLButtonElement>('#run')!;
const status = document.querySelector<HTMLElement>('#status')!;
const content = document.querySelector<HTMLElement>('#content')!;
const hostStatus = document.querySelector<HTMLElement>('#host-status')!;

// This is a synthetic fixture only. It is intentionally not a production
// Tableau mapping; live mappings must be supplied and approved by the host.
const syntheticViewActionPolicy: ViewActionPolicy = {
  scope: { dashboard: 'fixture-dashboard' },
  filterTargets: [
    {
      kind: 'worksheet-field',
      dashboard: 'fixture-dashboard',
      worksheet: 'fixture-dashboard',
      field: 'Region',
      valueType: 'string',
      allowedValues: ['West'],
    },
  ],
  parameterTargets: [
    {
      kind: 'parameter',
      dashboard: 'fixture-dashboard',
      name: 'fixture-threshold',
      valueType: 'number',
      allowedValues: [0, 1, 2],
    },
  ],
};
const syntheticInterventionProposal: ViewActionProposal = {
  id: 'fixture-verified-intervention-region',
  evidenceRef: 'local-analysis',
  scope: { dashboard: 'fixture-dashboard' },
  action: {
    type: 'set-filter',
    target: { kind: 'worksheet-field', worksheet: 'fixture-dashboard', field: 'Region' },
    values: ['West'],
  },
};
const mockViewActionAdapter = new MockViewActionAdapter({
  filters: { 'fixture-dashboard.Region': ['All'] },
  parameters: { 'fixture-threshold': 0 },
});
const failClosedViewActionAdapter: ViewActionAdapter = {
  async apply() {
    throw new Error('APPROVED_LIVE_VIEW_ACTION_CONFIGURATION_REQUIRED');
  },
  async undo() {
    throw new Error('APPROVED_LIVE_VIEW_ACTION_CONFIGURATION_REQUIRED');
  },
};

function isEmbeddedContext(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

let viewActionController = new ViewActionController(
  isEmbeddedContext() ? failClosedViewActionAdapter : mockViewActionAdapter,
  syntheticViewActionPolicy,
);
let activeViewActionProposal = syntheticInterventionProposal;
let canUndoViewAction = false;

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
  status.textContent = 'IDLE';
  status.dataset.status = 'idle';
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
    if (scenario.intervention.decision === 'INTERVENE' && isViewActionEligible(state)) {
      const badge = document.createElement('button');
      badge.className = 'intervention-badge';
      badge.dataset.testid = 'intervention-badge';
      badge.type = 'button';
      badge.textContent = '! INTERVENE';
      badge.title = 'Apply the approved view action to the current host.';
      badge.addEventListener('click', async () => {
        badge.disabled = true;
        const result = await viewActionController.apply(state, activeViewActionProposal);
        if (result.ok) {
          canUndoViewAction = true;
          state.audit.push('view-action.applied');
        } else {
          state.audit.push(`view-action.rejected: ${result.error}`);
        }
        render(state);
      });
      intervention.append(badge);
      if (canUndoViewAction) {
        const undo = document.createElement('button');
        undo.dataset.testid = 'view-action-undo';
        undo.type = 'button';
        undo.textContent = 'Undo view action';
        undo.addEventListener('click', async () => {
          undo.disabled = true;
          const result = await viewActionController.undo();
          state.audit.push(
            result.ok ? 'view-action.undone' : `view-action.undo-failed: ${result.error}`,
          );
          if (result.ok) canUndoViewAction = false;
          render(state);
        });
        intervention.append(undo);
      }
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
  viewActionController.resetForRun();
  canUndoViewAction = false;
  try {
    render(await client.replay(selectedScenario()));
  } catch {
    status.textContent = 'FAILED';
    status.dataset.status = 'failed';
    const error = document.createElement('p');
    error.className = 'error';
    error.textContent = 'The local analysis service could not complete this run.';
    content.replaceChildren(error);
  } finally {
    runButton.disabled = false;
  }
});

renderIdle(selectedScenario());

void initializeTableauHost().then(({ mode }) => {
  hostStatus.dataset.host = mode;
  hostStatus.textContent = mode === 'standalone' ? 'Standalone' : `Host: ${mode}`;
  if (mode === 'standalone') {
    viewActionController = new ViewActionController(
      mockViewActionAdapter,
      syntheticViewActionPolicy,
    );
    activeViewActionProposal = syntheticInterventionProposal;
  } else if (mode === 'tableau') {
    const configuration = approvedViewActionConfigurationFromGlobal();
    const api = tableauViewActionApiFromGlobal();
    if (configuration && api) {
      viewActionController = new ViewActionController(
        new TableauViewActionAdapter(api, configuration.policy),
        configuration.policy,
      );
      activeViewActionProposal = configuration.proposal;
    } else {
      viewActionController = new ViewActionController(
        failClosedViewActionAdapter,
        syntheticViewActionPolicy,
      );
    }
  }
});
