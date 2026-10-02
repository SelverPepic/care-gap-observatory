export const TEMPLATE = `
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true"><span></span><span></span></div>
        <div><p class="eyebrow">Public campaign evidence · Bosnia and Herzegovina</p><h1>Pomozi.ba Medical Care-Gap Observatory</h1></div>
      </div>
      <div class="top-actions">
        <span class="pilot-pill">Pomozi.ba · descriptive corpus</span>
        <button class="button ghost" id="methodButton">Methodology</button>
      </div>
    </header>

    <main>
      <section class="hero">
        <div>
          <p class="eyebrow accent" id="heroCorpus">Current coded public treatment cases</p>
          <h2>Understand medical needs,<br><em>care destinations and costs.</em></h2>
          <p class="hero-copy">A descriptive view of public Pomozi.ba treatment campaigns. It brings clinical, financial and geographical signals together while keeping source limitations visible. Use it to investigate patterns and generate better questions—not as national prevalence or a policy ranking.</p>
        </div>
        <div class="scope-card">
          <span class="scope-icon">i</span>
          <div><strong>Evidence, not a national census</strong><p>These are campaign-derived case records. Repeat appeals, missing fields and fundraising selection effects remain explicit.</p></div>
        </div>
      </section>

      <nav class="tabs" aria-label="Analysis sections">
        <button class="tab active" data-view="overview">Overview</button>
        <button class="tab" data-view="medical">Medical</button>
        <button class="tab" data-view="financial">Financial</button>
        <button class="tab" data-view="geographical">Geographical</button>
        <button class="tab" data-view="explore">Explore cases</button>
        <button class="tab" data-view="quality">Data quality</button>
      </nav>

      <section class="filterbar explore-filterbar" id="filterbar" aria-label="Case filters">
        <label class="search-wrap"><span>⌕</span><input id="searchInput" type="search" placeholder="Search patient, diagnosis, treatment or hospital…"></label>
        <label><span>Specialty</span><select id="specialtyFilter"><option value="">All specialties</option></select></label>
        <label><span>Diagnosis group</span><select id="diagnosisFilter"><option value="">All diagnoses</option></select></label>
        <label><span>Destination</span><select id="countryFilter"><option value="">All destinations</option></select></label>
        <label><span>Status</span><select id="statusFilter"><option value="">All statuses</option><option value="active">Active</option><option value="completed">Completed</option></select></label>
        <label><span>Age</span><select id="ageFilter"><option value="">All ages</option></select></label>
        <label><span>Publication year</span><select id="yearFilter"><option value="">All years</option></select></label>
        <label><span>Data review</span><select id="reviewFilter"><option value="">All records</option><option value="ready">Analysis-ready</option><option value="review">Requires review</option></select></label>
        <button class="button ghost compact" id="clearFilters">Clear filters</button>
      </section>

      <section id="overviewView" class="view active">
        <div id="kpis" class="kpi-grid"></div>
        <div class="section-heading"><div><p class="eyebrow">At a glance</p><h3>Major signals across the corpus</h3></div><p class="section-note">Open a specialist section for detail.</p></div>
        <div class="chart-grid two">
          <article class="panel"><div class="panel-head"><div><h4>Cases by specialty</h4><p>Share of campaign-derived cases</p></div><span class="chart-type">DONUT</span></div><div id="specialtyDonut" class="chart"></div></article>
          <article class="panel"><div class="panel-head"><div><h4>Where further care is named</h4><p>Domestic, abroad, mixed and unstated</p></div><span class="chart-type">STACKED BAR</span></div><div id="overviewPathways" class="chart"></div></article>
        </div>
        <div class="chart-grid two">
          <article class="panel"><div class="panel-head"><div><h4>Total quoted cost by specialty</h4><p>Total and annualized average across the corpus period</p></div><span class="chart-type">TOTAL + AVG/YEAR</span></div><div id="overviewSpecialtyCosts" class="chart"></div></article>
          <article class="panel"><div class="panel-head"><div><h4>Campaign publications over time</h4><p>Case records by publication year</p></div><span class="chart-type">HISTOGRAM</span></div><div id="caseTimeline" class="chart"></div></article>
        </div>
        <div class="chart-grid">
          <article class="panel"><div class="panel-head"><div><h4>Campaign status</h4><p>Current website status; closure dates are unavailable</p></div><span class="chart-type">STATUS</span></div><div id="campaignStatusStats" class="chart"></div></article>
        </div>
      </section>

      <section id="medicalView" class="view">
        <div class="section-heading"><div><p class="eyebrow">Clinical profile</p><h3>Diagnoses, specialties and treatment needs</h3></div></div>
        <div class="chart-grid">
          <article class="panel"><div class="panel-head"><div><h4>Cases by specialty</h4><p>Pie summary plus every specialty in a scrollable list</p></div><span class="chart-type">PIE + LIST</span></div><div id="medicalSpecialtyDonut" class="chart"></div></article>
        </div>
        <div class="chart-grid two">
          <article class="panel"><div class="panel-head"><div><h4>Most frequent campaign diagnoses</h4><p>Grouped from campaign wording</p></div><span class="chart-type">RANKED BAR</span></div><div id="diagnosisBars" class="chart"></div></article>
          <article class="panel"><div class="panel-head"><div><h4>Matched population prevalence</h4><p>The same diagnoses, shown beside their campaign counts</p></div><span class="chart-type">CAMPAIGN ↔ POPULATION</span></div><div id="populationContext" class="chart"></div></article>
        </div>
        <div class="chart-grid two">
          <article class="panel"><div class="panel-head"><div><h4>Malignant neoplasms: campaign breakdown</h4><p>Primary cancer site or type stated in the diagnosis</p></div><span class="chart-type">RANKED BAR</span></div><div id="malignantBreakdown" class="chart"></div></article>
          <article class="panel"><div class="panel-head"><div><h4>Cancer prevalence matched by type</h4><p>Campaign cases beside IARC five-year population prevalence</p></div><span class="chart-type">CAMPAIGN ↔ POPULATION</span></div><div id="cancerPrevalence" class="chart"></div></article>
        </div>
        <div class="chart-grid">
          <article class="panel"><div class="panel-head"><div><h4>Major population conditions absent from campaign diagnoses</h4><p>Important burden signals that public fundraising cases do not represent</p></div><span class="chart-type">REPRESENTATION GAP</span></div><div id="populationMissing" class="chart"></div></article>
        </div>
        <div class="chart-grid two">
          <article class="panel"><div class="panel-head"><div><h4>Why care is sought abroad</h4><p>Grouped analytical reasons; multiple may apply</p></div><span class="chart-type">BAR</span></div><div id="abroadBars" class="chart"></div></article>
          <article class="panel"><div class="panel-head"><div><h4>Earlier-treatment barriers</h4><p>Failure or insufficiency stated in source</p></div><span class="chart-type">BAR</span></div><div id="failureBars" class="chart"></div></article>
        </div>
        <div class="chart-grid">
          <article class="panel"><div class="panel-head"><div><h4>Specialty × treatment</h4><p>Cases in each clinical intersection</p></div><span class="chart-type">MATRIX</span></div><div id="treatmentMatrix" class="chart"></div></article>
        </div>
        <div class="chart-grid">
          <article class="panel"><div class="panel-head"><div><h4>Age distribution</h4><p>Age at campaign publication, where stated</p></div><span class="chart-type">HISTOGRAM</span></div><div id="ageHistogram" class="chart"></div></article>
        </div>
        <div class="chart-grid two">
          <article class="panel"><div class="panel-head"><div><h4>Treatment urgency</h4><p>Conservative groups from explicit narrative wording</p></div><span class="chart-type">BAR</span></div><div id="urgencyStats" class="chart"></div></article>
          <article class="panel"><div class="panel-head"><div><h4>Treatment outcomes</h4><p>Website narratives only; missing follow-up stays unknown</p></div><span class="chart-type">FOLLOW-UP</span></div><div id="outcomeStats" class="chart"></div></article>
        </div>
      </section>

      <section id="financialView" class="view">
        <div class="section-heading"><div><p class="eyebrow">Financial profile</p><h3>Quoted treatment costs and campaign targets</h3></div><p class="section-note">Unknown costs remain excluded rather than treated as zero.</p></div>
        <div id="financialKpis" class="kpi-grid three"></div>
        <div class="chart-grid two">
          <article class="panel"><div class="panel-head"><div><h4>Treatment-cost distribution</h4><p>Known quoted medical costs, standardized to BAM</p></div><span class="chart-type">HISTOGRAM</span></div><div id="costHistogram" class="chart"></div></article>
          <article class="panel"><div class="panel-head"><div><h4>Cost spread by specialty</h4><p>Median, quartiles and range; known costs only</p></div><span class="chart-type">BOX PLOT</span></div><div id="costBoxplot" class="chart"></div></article>
        </div>
        <div class="chart-grid two">
          <article class="panel"><div class="panel-head"><div><h4>Total quoted cost by specialty</h4><p>Total and annualized average across the full corpus period</p></div><span class="chart-type">TOTAL + AVG/YEAR</span></div><div id="financialSpecialtyCosts" class="chart"></div></article>
          <article class="panel"><div class="panel-head"><div><h4>Campaign targets by specialty</h4><p>Public fundraising targets, where stated</p></div><span class="chart-type">RANKED BAR</span></div><div id="financialTargets" class="chart"></div></article>
        </div>
      </section>

      <section id="geographicalView" class="view">
        <div class="section-heading"><div><p class="eyebrow">Geographical profile</p><h3>Domestic and international care destinations</h3></div><p class="section-note">Named treatment destinations—not verified travel.</p></div>
        <div id="flowKpis" class="kpi-grid flow-kpis"></div>
        <div class="chart-grid two">
          <article class="panel"><div class="panel-head"><div><h4>Domestic vs abroad</h4><p>Named destinations plus separately labeled domestic evidence</p></div><span class="chart-type">STACKED BAR</span></div><div id="pathwaySummary" class="chart"></div></article>
          <article class="panel"><div class="panel-head"><div><h4>Destination countries</h4><p>Case-country pairs; one case may name multiple countries</p></div><span class="chart-type">RANKED BAR</span></div><div id="countryFlowBars" class="chart"></div></article>
        </div>
        <div class="chart-grid">
          <article class="panel"><div class="panel-head"><div><h4>Domestic evidence within unstated destinations</h4><p>Source-grounded categories without replacing the original missing country</p></div><span class="chart-type">EVIDENCE REVIEW</span></div><div id="domesticEvidence" class="chart"></div></article>
        </div>
        <div class="chart-grid two-one">
          <article class="panel"><div class="panel-head"><div><h4>Pathway by specialty</h4><p>Domestic evidence, likely domestic aftercare, abroad, mixed and unstated</p></div><span class="chart-type">STACKED MATRIX</span></div><div id="specialtyFlowMatrix" class="chart"></div></article>
          <article class="panel"><div class="panel-head"><div><h4>Foreign hospitals by country</h4><p>Named institutions; missing names remain visible</p></div><span class="chart-type">TABLE</span></div><div id="hospitalFlowTable" class="chart hospital-flow-table"></div></article>
        </div>
      </section>

      <section id="exploreView" class="view">
        <div class="section-heading explore-heading"><div><p class="eyebrow">Case exploration</p><h3>Explore source-linked case records</h3></div><button class="button ghost" id="exportCsv">Export filtered CSV</button></div>
        <div class="section-heading"><div><p class="eyebrow">Filtered results</p><h3 id="exploreResultTitle">All case records</h3></div><p class="section-note" id="filterSummary"></p></div>
        <div id="exploreStats" class="kpi-grid compact-kpis"></div>
        <article class="agent-card">
          <div><p class="eyebrow accent">Deeper analysis</p><h4>Ask an agent to investigate this selection</h4><p id="agentSummary">The agent receives the active filters and can inspect the underlying source-linked records, compare subgroups and explain data limitations.</p></div>
          <button class="button primary" id="askAgent">Analyze with agent</button>
        </article>
        <div class="table-wrap"><table><thead><tr><th>#</th><th>Patient / campaign</th><th>Specialty</th><th>Main diagnosis</th><th>Proposed care</th><th>Quoted cost</th><th>Website amount</th><th>Status</th></tr></thead><tbody id="caseRows"></tbody></table></div>

      </section>

      <section id="qualityView" class="view">
        <div class="section-heading"><div><p class="eyebrow">Data quality</p><h3>Coverage, provenance and review needs</h3></div><p class="section-note">Quality statistics follow the active case filters.</p></div>
        <div id="qualityKpis" class="kpi-grid compact-kpis"></div>
        <div class="quality-grid">
          <article class="panel"><div class="panel-head"><div><h4>Completeness in this selection</h4><p>Unknown means not stated—not “no”</p></div><span class="chart-type">QUALITY</span></div><div id="completenessBars" class="chart"></div></article>
          <article class="panel"><h4>How to interpret the coding</h4><ul class="principle-list"><li><b>Explicit</b><span>Directly stated by Pomozi.ba.</span></li><li><b>Inferred</b><span>Conservative categorization from source wording.</span></li><li><b>Unknown</b><span>Not available in the public campaign.</span></li><li><b>Review flag</b><span>Needs analyst attention; it is not a clinical judgment.</span></li></ul></article>
        </div>
        <article class="panel data-tools"><div><h4>Manual dataset update</h4><p class="panel-copy">Import a reviewed JSON dataset for this browser, or restore the bundled corpus.</p></div><div class="tool-actions"><label class="button primary" for="jsonImport">Import JSON</label><input id="jsonImport" type="file" accept="application/json"><button class="button ghost" id="downloadJson">Download current JSON</button><button class="button danger-ghost" id="resetData">Restore bundled data</button></div><p id="importStatus" class="status-line" role="status"></p></article>
      </section>
    </main>
  </div>

  <dialog id="methodDialog"><button class="dialog-close" aria-label="Close">×</button><p class="eyebrow">Methodology</p><h3>What this observatory measures</h3><div id="methodContent"></div></dialog>
  <dialog id="caseDialog"><button class="dialog-close" aria-label="Close">×</button><div id="caseDetail"></div></dialog>
`;
