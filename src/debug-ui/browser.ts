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
import { resolveViewIntent, type ViewIntentResolution } from './view-intents.js';
import {
  CapabilityCatalogController,
  type CapabilityCatalog,
  type FilterCapability,
  type ParameterCapability,
} from './capability-catalog.js';

const client = new HttpAnalysisClient();
const select = document.querySelector<HTMLSelectElement>('#scenario')!;
const runButton = document.querySelector<HTMLButtonElement>('#run')!;
const status = document.querySelector<HTMLElement>('#status')!;
const content = document.querySelector<HTMLElement>('#content')!;
const hostStatus = document.querySelector<HTMLElement>('#host-status')!;
const capabilityRefreshButton = document.querySelector<HTMLButtonElement>('#refresh-capabilities')!;

const unconfiguredViewActionPolicy: ViewActionPolicy = {
  scope: { dashboard: 'unconfigured' },
  filterTargets: [],
  parameterTargets: [],
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

let viewActionController = new ViewActionController(
  failClosedViewActionAdapter,
  unconfiguredViewActionPolicy,
);
let activeViewActionPolicy = unconfiguredViewActionPolicy;
let activeViewIntentMappings: unknown = [];
let hostMode: 'unknown' | 'standalone' | 'tableau' = 'unknown';
let observedHostDashboard: string | undefined;
let hostEpoch = 0;
let activeRunId: string | undefined;
let activeViewActionResolution: ViewIntentResolution = {
  status: 'NO_ACTION',
  reason: 'No verified view intent is available for this run.',
};
let canUndoViewAction = false;
let capabilityController: CapabilityCatalogController | undefined;
let capabilityCatalog: CapabilityCatalog | undefined;
let capabilityMessage = 'Waiting for the Tableau host.';
let capabilityRefreshInFlight = false;

function resolveRunAction(state: ReplayState): ViewIntentResolution {
  const hostDashboard = observeHostScope();
  if (hostMode === 'tableau' && hostDashboard !== activeViewActionPolicy.scope.dashboard) {
    return {
      status: 'REJECTED',
      reason: 'The current Tableau dashboard is outside the approved scope.',
    };
  }
  if (hostMode === 'unknown') {
    return { status: 'NO_ACTION', reason: 'The host scope is not initialized.' };
  }
  if (!state.viewIntent || !state.runId) {
    return { status: 'NO_ACTION', reason: 'No verified view intent is available for this run.' };
  }
  return resolveViewIntent({
    intent: state.viewIntent,
    context: {
      runId: state.runId,
      verification: scenarioStatus(state) === 'VERIFIED' ? 'VERIFIED' : 'UNVERIFIED',
      intervention: state.scenario.intervention?.decision,
      verifiedEvidenceIds: state.verifiedEvidenceIds ?? [],
    },
    mappings: activeViewIntentMappings,
    policy: activeViewActionPolicy,
  });
}

function observeHostScope(): string | undefined {
  const dashboard =
    hostMode === 'standalone'
      ? activeViewActionPolicy.scope.dashboard
      : hostMode === 'tableau'
        ? tableauViewActionApiFromGlobal()?.dashboard.name
        : undefined;
  const identity = typeof dashboard === 'string' ? dashboard : undefined;
  if (identity !== observedHostDashboard) {
    hostEpoch += 1;
    viewActionController.resetForRun();
    canUndoViewAction = false;
    activeViewActionResolution = {
      status: 'NO_ACTION',
      reason: 'The host dashboard scope changed; the previous action was invalidated.',
    };
    observedHostDashboard = identity;
    if (hostMode === 'tableau') {
      capabilityController?.invalidate();
      capabilityCatalog = undefined;
      capabilityMessage = identity
        ? 'Dashboard scope changed; refresh the capability catalog.'
        : 'The active dashboard scope is unavailable.';
    }
  }
  return identity;
}

function scenarioStatus(state: ReplayState): string {
  return state.scenario.verifier.status;
}

function formatProposal(proposal: ViewActionProposal): string {
  if (proposal.action.type === 'set-filter') {
    return `set ${proposal.action.target.field} to ${proposal.action.values.join(', ')}`;
  }
  return `set ${proposal.action.target.name} to ${String(proposal.action.value)}`;
}

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

function capabilityState(capability: FilterCapability | ParameterCapability): string {
  const authorization = capability.state.authorization;
  return `${capability.state.read} · candidate ${capability.state.candidate} · approved ${authorization.approved ? 'yes' : 'no'} · executable ${authorization.executable ? 'yes' : 'no'}`;
}

function renderCapabilityCatalog(): HTMLElement {
  if (!capabilityCatalog) {
    const message = document.createElement('p');
    message.dataset.testid = 'capability-status';
    message.textContent = capabilityMessage;
    return panel('Action Capability Catalog', message);
  }
  const body = document.createElement('div');
  const summary = document.createElement('p');
  summary.dataset.testid = 'capability-status';
  summary.textContent = `Dashboard: ${capabilityCatalog.dashboard.name} · captured ${capabilityCatalog.freshness.capturedAt}`;
  body.append(summary);
  const groups = document.createElement('ul');
  for (const worksheet of capabilityCatalog.worksheets) {
    const row = document.createElement('li');
    row.append(text(`Worksheet ${worksheet.name} (${worksheet.read})`));
    if (worksheet.reason)
      row.append(Object.assign(document.createElement('small'), { textContent: worksheet.reason }));
    const filters = document.createElement('ul');
    for (const filter of worksheet.filters) {
      const filterRow = document.createElement('li');
      const values = filter.candidateValues
        ? ` · candidates: ${filter.candidateValues.join(', ') || 'none'}`
        : '';
      const current = filter.currentValues
        ? ` · current: ${filter.currentValues.join(', ') || 'none'}${filter.allSelected ? ' (all selected)' : ''}`
        : ` · current: unavailable (${filter.state.candidateReason ?? 'CURRENT_SELECTION_UNAVAILABLE'})`;
      filterRow.append(text(`Filter ${filter.field} (${filter.filterType})${current}${values}`));
      filterRow.append(
        Object.assign(document.createElement('small'), {
          textContent: `${capabilityState(filter)}${filter.state.candidateReason ? ` · ${filter.state.candidateReason}` : ''}`,
        }),
      );
      filters.append(filterRow);
    }
    if (worksheet.filters.length > 0) row.append(filters);
    groups.append(row);
  }
  for (const parameter of capabilityCatalog.parameters) {
    const row = document.createElement('li');
    const values = parameter.candidateValues
      ? ` · candidates: ${parameter.candidateValues.join(', ') || 'none'}`
      : '';
    const range =
      parameter.domain?.kind === 'range'
        ? ` · range: ${String(parameter.domain.minValue)}–${String(parameter.domain.maxValue)}${parameter.domain.stepSize ? ` step ${parameter.domain.stepSize}` : ''}${parameter.domain.dateStepPeriod ? ` per ${parameter.domain.dateStepPeriod}` : ''}`
        : '';
    row.append(
      text(
        `Parameter ${parameter.name} = ${String(parameter.currentValue ?? 'unavailable')}${values}${range}`,
      ),
    );
    row.append(
      Object.assign(document.createElement('small'), {
        textContent: `${capabilityState(parameter)}${parameter.state.candidateReason ? ` · ${parameter.state.candidateReason}` : ''}`,
      }),
    );
    groups.append(row);
  }
  if (groups.childElementCount === 0)
    groups.append(
      Object.assign(document.createElement('li'), {
        textContent: 'No readable worksheet filters or parameters.',
      }),
    );
  body.append(groups);
  if (capabilityCatalog.issues.length > 0) {
    const issues = document.createElement('p');
    issues.textContent = `Read issues: ${capabilityCatalog.issues.map((issue) => `${issue.scope} (${issue.reason})`).join('; ')}`;
    body.append(issues);
  }
  return panel('Action Capability Catalog', body);
}

function renderIdle(scenario: DebugScenario): void {
  status.textContent = 'IDLE';
  status.dataset.status = 'idle';
  content.replaceChildren(
    panel(
      'Replay',
      Object.assign(document.createElement('p'), { textContent: scenario.description }),
    ),
    renderCapabilityCatalog(),
  );
}

function render(state: ReplayState): void {
  activeViewActionResolution = resolveRunAction(state);
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
    if (
      scenario.intervention.decision === 'INTERVENE' &&
      isViewActionEligible(state) &&
      activeViewActionResolution.status === 'READY'
    ) {
      const badge = document.createElement('button');
      badge.className = 'intervention-badge';
      badge.dataset.testid = 'intervention-badge';
      badge.type = 'button';
      badge.textContent = '! INTERVENE';
      badge.title = 'Apply the approved view action to the current host.';
      badge.addEventListener('click', async () => {
        badge.disabled = true;
        const currentResolution = resolveRunAction(state);
        if (currentResolution.status !== 'READY') {
          state.audit.push(`view-action.rejected: ${currentResolution.reason}`);
          render(state);
          return;
        }
        if (activeRunId !== state.runId) return;
        const runId = state.runId;
        const actionHostEpoch = hostEpoch;
        const result = await viewActionController.apply(state, currentResolution.proposal);
        observeHostScope();
        if (activeRunId !== runId || hostEpoch !== actionHostEpoch) return;
        if (result.ok) {
          canUndoViewAction = true;
          if (state.audit.at(-1) !== 'view-action.applied') {
            state.audit.push('view-action.applied');
          }
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
          const actionHostEpoch = hostEpoch;
          const currentDashboard = observeHostScope();
          if (
            hostMode === 'tableau' &&
            currentDashboard !== activeViewActionPolicy.scope.dashboard
          ) {
            state.audit.push(
              'view-action.undo-failed: The current Tableau dashboard is outside the approved scope.',
            );
            render(state);
            return;
          }
          const result = await viewActionController.undo();
          observeHostScope();
          if (activeRunId !== state.runId || hostEpoch !== actionHostEpoch) return;
          state.audit.push(
            result.ok ? 'view-action.undone' : `view-action.undo-failed: ${result.error}`,
          );
          if (result.ok) canUndoViewAction = false;
          render(state);
        });
        intervention.append(undo);
      }
    }
    if (activeViewActionResolution.status !== 'READY') {
      const diagnostic = document.createElement('small');
      diagnostic.textContent = `No executable view action: ${activeViewActionResolution.reason}`;
      diagnostic.dataset.testid = 'view-action-diagnostic';
      intervention.append(diagnostic);
    } else {
      const proposal = document.createElement('small');
      proposal.textContent = `Proposed change: ${formatProposal(activeViewActionResolution.proposal)}`;
      proposal.dataset.testid = 'view-action-proposal';
      intervention.append(proposal);
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
    renderCapabilityCatalog(),
  );
  if (scenario.error) {
    const error = document.createElement('p');
    error.className = 'error';
    error.textContent = scenario.error;
    content.prepend(error);
  }
}

async function refreshCapabilityCatalog(): Promise<void> {
  if (!capabilityController || capabilityRefreshInFlight) return;
  observeHostScope();
  capabilityRefreshInFlight = true;
  capabilityRefreshButton.disabled = true;
  capabilityMessage = 'Reading the active Tableau dashboard…';
  capabilityCatalog = undefined;
  renderIdle(selectedScenario());
  try {
    const result = await capabilityController.refresh();
    if (result.status === 'applied') {
      capabilityCatalog = result.catalog;
      capabilityMessage = 'Capability catalog refreshed.';
    } else {
      capabilityMessage =
        result.status === 'stale' ? `Catalog discarded: ${result.reason}.` : result.reason;
    }
  } catch {
    capabilityMessage = 'Capability discovery failed closed.';
  } finally {
    capabilityRefreshInFlight = false;
    capabilityRefreshButton.disabled = !capabilityController;
    renderIdle(selectedScenario());
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

select.addEventListener('change', () => {
  activeRunId = undefined;
  viewActionController.resetForRun();
  canUndoViewAction = false;
  renderIdle(selectedScenario());
});
runButton.addEventListener('click', async () => {
  runButton.disabled = true;
  status.textContent = 'RUNNING';
  status.dataset.status = 'running';
  viewActionController.resetForRun();
  canUndoViewAction = false;
  activeRunId = undefined;
  activeViewActionResolution = {
    status: 'NO_ACTION',
    reason: 'Resolving the verified view intent for this run.',
  };
  content.replaceChildren(
    Object.assign(document.createElement('p'), { textContent: 'Starting replay…' }),
  );
  try {
    const state = await client.replay(selectedScenario());
    activeRunId = state.runId;
    render(state);
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

capabilityRefreshButton.addEventListener('click', () => {
  void refreshCapabilityCatalog();
});

renderIdle(selectedScenario());

void initializeTableauHost().then(({ mode }) => {
  hostMode = mode === 'standalone' ? 'standalone' : mode === 'tableau' ? 'tableau' : 'unknown';
  hostStatus.dataset.host = mode;
  hostStatus.textContent = mode === 'standalone' ? 'Standalone' : `Host: ${mode}`;
  if (mode === 'standalone') {
    const configuration = approvedViewActionConfigurationFromGlobal();
    if (configuration) {
      viewActionController = new ViewActionController(mockViewActionAdapter, configuration.policy);
      activeViewActionPolicy = configuration.policy;
      activeViewIntentMappings = configuration.mappings ?? [];
    }
  } else if (mode === 'tableau') {
    const configuration = approvedViewActionConfigurationFromGlobal();
    const api = tableauViewActionApiFromGlobal();
    if (configuration && api) {
      viewActionController = new ViewActionController(
        new TableauViewActionAdapter(api, configuration.policy),
        configuration.policy,
      );
      activeViewActionPolicy = configuration.policy;
      activeViewIntentMappings = configuration.mappings ?? [];
    } else {
      viewActionController = new ViewActionController(
        failClosedViewActionAdapter,
        unconfiguredViewActionPolicy,
      );
      activeViewActionPolicy = unconfiguredViewActionPolicy;
      activeViewIntentMappings = [];
    }
    capabilityController = new CapabilityCatalogController(() => tableauViewActionApiFromGlobal());
    capabilityRefreshButton.disabled = false;
    void refreshCapabilityCatalog();
  } else {
    capabilityRefreshButton.disabled = true;
    capabilityMessage =
      mode === 'tableau-unavailable'
        ? 'Tableau Extensions API is unavailable.'
        : 'Tableau host initialization failed.';
    renderIdle(selectedScenario());
  }
});
