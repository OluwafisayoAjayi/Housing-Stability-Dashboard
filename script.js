const stateSelect = document.getElementById("stateSelect");
const countySelect = document.getElementById("countySelect");
const dataBadge = document.getElementById("dataBadge");
const setupWarning = document.getElementById("setupWarning");
const plannerForm = document.getElementById("plannerForm");
const startOverBtn = document.getElementById("startOverBtn");
const preResultPanel = document.getElementById("preResultPanel");
const resultsContainer = document.getElementById("resultsContainer");
const scenarioSelect = document.getElementById("scenarioSelect");
const customScenarioInputs = document.getElementById("customScenarioInputs");

let countyData = [];
let currentRecord = null;
let lastResult = null;

const chartColors = ["#2f6fed", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#64748b"];

function money(value) {
  if (!Number.isFinite(value)) return "--";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function pct(value, decimals = 1) {
  if (!Number.isFinite(value)) return "--";
  return `${value.toFixed(decimals)}%`;
}

function clamp(value, min = 0, max = 100) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function getNumber(id) {
  const element = document.getElementById(id);
  const value = Number(element.value);
  return Number.isFinite(value) ? value : 0;
}

function uniqueSorted(items) {
  return [...new Set(items.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}

function noDataMode(message = "No real data loaded") {
  dataBadge.textContent = message;
  setupWarning.hidden = false;
  stateSelect.innerHTML = `<option>No data</option>`;
  countySelect.innerHTML = `<option>No data</option>`;
}

async function loadData() {
  try {
    const [dataResponse, metadataResponse] = await Promise.all([
      fetch("data/county_indicators.json", { cache: "no-store" }),
      fetch("data/metadata.json", { cache: "no-store" })
    ]);

    if (!dataResponse.ok) throw new Error("county_indicators.json not found");
    countyData = await dataResponse.json();

    let metadata = {};
    if (metadataResponse.ok) metadata = await metadataResponse.json();

    if (!Array.isArray(countyData) || countyData.length === 0) {
      noDataMode("Real ACS data not loaded yet");
      return;
    }

    countyData = countyData.filter(d => d && d.sample_data !== true && d.state_name && d.county_name && d.year);
    if (countyData.length === 0) {
      noDataMode("Only sample or invalid data found");
      return;
    }

    const latestYear = Math.max(...countyData.map(d => Number(d.year)).filter(Number.isFinite));
    dataBadge.textContent = Number.isFinite(latestYear)
      ? `Real ACS county data loaded • Latest vintage: ${latestYear - 4}–${latestYear}`
      : "Real ACS county data loaded";

    setupWarning.hidden = true;
    fillStateOptions();
    fillCountyOptions();
    updateCountyContext();
  } catch (error) {
    console.error(error);
    noDataMode("Data file missing");
  }
}

function fillStateOptions() {
  const states = uniqueSorted(countyData.map(d => d.state_name));
  stateSelect.innerHTML = states.map(s => `<option value="${s}">${s}</option>`).join("");
}

function fillCountyOptions() {
  const state = stateSelect.value;
  const counties = uniqueSorted(countyData.filter(d => d.state_name === state).map(d => d.county_name));
  countySelect.innerHTML = counties.map(c => `<option value="${c}">${c}</option>`).join("");
}

function findLatestRecord() {
  const state = stateSelect.value;
  const county = countySelect.value;
  const records = countyData
    .filter(d => d.state_name === state && d.county_name === county)
    .sort((a, b) => Number(b.year) - Number(a.year));
  currentRecord = records[0] || null;
  return currentRecord;
}

function dataVintage(record) {
  const endYear = Number(record?.year);
  return Number.isFinite(endYear)
    ? `${endYear - 4}–${endYear} ACS 5-year estimates`
    : "Latest ACS 5-year estimates";
}

function updateCountyContext(record = null) {
  const rec = record || findLatestRecord();
  if (!rec) return;

  document.getElementById("selectedPlace").textContent = `${rec.county_name}, ${rec.state_name}`;
  document.getElementById("povertyRate").textContent = pct(Number(rec.poverty_rate));
  document.getElementById("unemploymentRate").textContent = pct(Number(rec.unemployment_rate));
  document.getElementById("medianRent").textContent = money(Number(rec.median_gross_rent));
  document.getElementById("medianIncome").textContent = money(Number(rec.median_household_income));
  document.getElementById("renterShare").textContent = pct(Number(rec.renter_share));
  document.getElementById("severeRentBurden").textContent = pct(Number(rec.severe_rent_burden_rate));
  document.getElementById("basicNeeds").textContent = Number(rec.basic_monthly_cost) > 0 ? money(Number(rec.basic_monthly_cost)) : "Optional";
  document.getElementById("contextYear").textContent = dataVintage(rec);
}

function calculateLocalStress(record) {
  if (!record) return 0;
  const povertyScore = clamp((Number(record.poverty_rate) / 30) * 100);
  const unemploymentScore = clamp((Number(record.unemployment_rate) / 12) * 100);
  const monthlyMedianIncome = Number(record.median_household_income) / 12;
  const rentPressure = monthlyMedianIncome > 0 ? Number(record.median_gross_rent) / monthlyMedianIncome : 0;
  const rentPressureScore = clamp(((rentPressure - 0.20) / 0.35) * 100);
  const renterShareScore = clamp((Number(record.renter_share) / 60) * 100);
  const severeRentScore = clamp((Number(record.severe_rent_burden_rate) / 35) * 100);

  return clamp(
    povertyScore * 0.25 +
    unemploymentScore * 0.20 +
    rentPressureScore * 0.25 +
    renterShareScore * 0.15 +
    severeRentScore * 0.15
  );
}

function householdScore(values) {
  const income = Math.max(values.income, 1);
  const housingCosts = values.rent + values.utilities;
  const essentialExpenses = housingCosts + values.essentials + values.debt;
  const burden = housingCosts / income;
  const cushion = income - essentialExpenses;
  const savingsMonths = values.savings / Math.max(essentialExpenses, 1);

  const burdenScore = clamp(((burden - 0.30) / 0.40) * 100);
  const cushionTarget = income * 0.10;
  const cushionScore = clamp(((cushionTarget - cushion) / Math.max(income * 0.30, 1)) * 100);
  const savingsScore = clamp(((3 - savingsMonths) / 3) * 100);

  return {
    score: clamp(burdenScore * 0.40 + cushionScore * 0.35 + savingsScore * 0.25),
    burden,
    cushion,
    savingsMonths,
    essentialExpenses,
    housingCosts
  };
}

function finalScore(household, localStress) {
  return clamp(household.score * 0.75 + localStress * 0.25);
}

function classify(score) {
  if (score < 25) {
    return {
      label: "Low planning concern",
      className: "status-low",
      text: "Your submitted budget appears relatively manageable based on your housing costs, cash flow, savings coverage, and county context."
    };
  }
  if (score < 50) {
    return {
      label: "Moderate planning concern",
      className: "status-moderate",
      text: "Your submitted budget shows some pressure points. A rent increase, utility increase, or income loss could reduce your stability."
    };
  }
  if (score < 75) {
    return {
      label: "High planning concern",
      className: "status-high",
      text: "Your submitted budget shows meaningful housing-cost or cash-flow pressure and may need a stronger savings or assistance plan."
    };
  }
  return {
    label: "Severe planning concern",
    className: "status-severe",
    text: "Your submitted budget shows strong financial pressure. This is not a legal eviction prediction, but the budget situation needs attention."
  };
}

function setBar(id, value) {
  document.getElementById(id).style.width = `${clamp(value)}%`;
}

function makeSummary(values, household, localStress, score, status, record) {
  const housingPct = household.burden * 100;
  const rentComparison = Number(record.median_gross_rent) > 0
    ? values.rent - Number(record.median_gross_rent)
    : null;

  let burdenText = "below the common 30% affordability threshold";
  if (housingPct > 50) burdenText = "above the severe 50% cost-burden threshold";
  else if (housingPct > 30) burdenText = "above the common 30% affordability threshold";

  const cushionText = household.cushion >= 0
    ? `After your rent, utilities, essentials, and required payments, your monthly cushion is about ${money(household.cushion)}.`
    : `After your rent, utilities, essentials, and required payments, your budget is short by about ${money(Math.abs(household.cushion))} each month.`;

  const rentText = rentComparison === null
    ? "County median rent was not available for comparison."
    : rentComparison >= 0
      ? `Your rent is about ${money(rentComparison)} higher than the county median gross rent.`
      : `Your rent is about ${money(Math.abs(rentComparison))} lower than the county median gross rent.`;

  return `Based on the values you submitted for ${record.county_name}, ${record.state_name}, your result is ${status.label.toLowerCase()} with a score of ${score}/100. Your rent and utilities take ${pct(housingPct)} of your monthly income, which is ${burdenText}. ${cushionText} Your emergency savings cover about ${household.savingsMonths.toFixed(1)} months of essential expenses. ${rentText} The county stress score is ${Math.round(localStress)}/100, which gives local context but does not determine your household outcome by itself.`;
}

function guidance(values, household, localStress, score, record) {
  const items = [];
  const housingPct = household.burden * 100;

  if (housingPct > 50) {
    items.push("Your housing costs are above the severe cost-burden threshold. Consider checking whether you qualify for rental assistance, utility assistance, or other local support. Also review whether any recurring costs can be reduced.");
  } else if (housingPct > 30) {
    items.push("Your housing costs are above the common affordability threshold. Track rent and utility bills closely and be careful about taking on new fixed monthly payments.");
  } else {
    items.push("Your housing costs are below the common 30% affordability threshold based on your submitted values. Continue monitoring rent and utility changes.");
  }

  if (household.cushion < 0) {
    items.push(`Your monthly budget is negative by about ${money(Math.abs(household.cushion))}. A first planning step is to identify the largest cost categories and consider support options before payments are missed.`);
  } else if (household.cushion < values.income * 0.10) {
    items.push("Your monthly cushion is small. Building even a small recurring savings plan may help protect you from unexpected bills or temporary income loss.");
  } else {
    items.push("Your monthly cushion is positive, which gives you more room to absorb unexpected expenses.");
  }

  if (household.savingsMonths < 1) {
    items.push("Your emergency savings cover less than one month of essential expenses. A first planning target is one month of rent, utilities, and essential costs.");
  } else if (household.savingsMonths < 3) {
    items.push("Your emergency savings cover at least one month but less than three months. A three-month target would provide a stronger safety buffer.");
  } else {
    items.push("Your emergency savings cover at least three months of essential expenses, which is a stronger stability buffer.");
  }

  if (localStress > 60) {
    items.push(`Your selected county has elevated local economic stress. Poverty, unemployment, rent pressure, renter share, or severe renter cost burden may make financial disruptions harder for households in ${record.county_name}.`);
  }

  if (score >= 50) {
    items.push("Use this tool for planning only. It does not know your lease terms, landlord decisions, court rules, emergency aid availability, or legal protections.");
  }

  return items;
}

function clearHouseholdInputs() {
  ["income", "rent", "utilities", "essentials", "savings", "debt"].forEach(id => {
    document.getElementById(id).value = "";
  });
}

function renderMainResult(result) {
  const { values, household, localStress, score, status, record } = result;

  preResultPanel.classList.add("hidden");
  resultsContainer.classList.remove("hidden");

  const riskLabel = document.getElementById("riskLabel");
  riskLabel.textContent = status.label;
  riskLabel.className = status.className;
  document.getElementById("riskText").textContent = status.text;
  document.getElementById("scoreValue").textContent = score;
  document.getElementById("scoreRing").style.setProperty("--score", score);
  document.getElementById("resultSummary").textContent = makeSummary(values, household, localStress, score, status, record);

  document.getElementById("housingBurden").textContent = pct(household.burden * 100);
  document.getElementById("monthlyCushion").textContent = money(household.cushion);
  document.getElementById("savingsMonths").textContent = `${household.savingsMonths.toFixed(1)} months`;
  document.getElementById("localStress").textContent = `${Math.round(localStress)}/100`;

  setBar("housingBurdenBar", household.burden * 100);
  setBar("cushionBar", household.cushion <= 0 ? 100 : clamp(100 - (household.cushion / Math.max(values.income, 1)) * 300));
  setBar("savingsBar", clamp((household.savingsMonths / 3) * 100));
  setBar("localStressBar", localStress);

  updateCountyContext(record);

  document.getElementById("guidanceList").innerHTML = guidance(values, household, localStress, score, record)
    .map(item => `<li>${item}</li>`)
    .join("");

  drawCharts(result);
  renderScenario();
}

function getScenarioChanges() {
  const selected = scenarioSelect.value;
  if (selected === "income_loss") return { incomeChange: -15, rentChange: 0, utilityChange: 0 };
  if (selected === "rent_increase") return { incomeChange: 0, rentChange: 10, utilityChange: 0 };
  if (selected === "utility_increase") return { incomeChange: 0, rentChange: 0, utilityChange: 25 };
  if (selected === "combined") return { incomeChange: -15, rentChange: 10, utilityChange: 25 };
  if (selected === "custom") {
    return {
      incomeChange: getNumber("customIncomeChange"),
      rentChange: getNumber("customRentChange"),
      utilityChange: getNumber("customUtilityChange")
    };
  }
  return { incomeChange: 0, rentChange: 0, utilityChange: 0 };
}

function renderScenario() {
  customScenarioInputs.classList.toggle("hidden", scenarioSelect.value !== "custom");
  if (!lastResult) return;

  const changes = getScenarioChanges();
  const values = lastResult.values;
  const scenarioValues = {
    ...values,
    income: Math.max(values.income * (1 + changes.incomeChange / 100), 1),
    rent: Math.max(values.rent * (1 + changes.rentChange / 100), 0),
    utilities: Math.max(values.utilities * (1 + changes.utilityChange / 100), 0)
  };

  const scenarioHousehold = householdScore(scenarioValues);
  const scenarioScoreValue = Math.round(finalScore(scenarioHousehold, lastResult.localStress));
  const change = scenarioScoreValue - lastResult.score;

  document.getElementById("scenarioScore").textContent = `${scenarioScoreValue}/100`;
  document.getElementById("scenarioBurden").textContent = pct(scenarioHousehold.burden * 100);
  document.getElementById("scenarioCushion").textContent = money(scenarioHousehold.cushion);
  document.getElementById("scoreChange").textContent = `${change >= 0 ? "+" : ""}${change} points`;
}

function prepareCanvas(canvasId) {
  const canvas = document.getElementById(canvasId);
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(rect.width, 280);
  const height = Number(canvas.getAttribute("height")) || 260;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { canvas, ctx, width, height };
}

function drawBudgetPie(values, household) {
  const { ctx, width, height } = prepareCanvas("budgetPie");
  const remaining = Math.max(household.cushion, 0);
  const slices = [
    { label: "Rent", value: values.rent, color: chartColors[0] },
    { label: "Utilities", value: values.utilities, color: chartColors[1] },
    { label: "Essentials", value: values.essentials, color: chartColors[2] },
    { label: "Debt/payments", value: values.debt, color: chartColors[3] },
    { label: "Remaining cushion", value: remaining, color: chartColors[4] }
  ].filter(d => d.value > 0);

  const total = slices.reduce((sum, d) => sum + d.value, 0);
  const radius = Math.min(width, height) * 0.33;
  const cx = width / 2;
  const cy = height / 2;

  if (total <= 0) return;

  let start = -Math.PI / 2;
  slices.forEach(slice => {
    const angle = (slice.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, start + angle);
    ctx.closePath();
    ctx.fillStyle = slice.color;
    ctx.fill();
    start += angle;
  });

  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.fillStyle = "#1f2937";
  ctx.font = "700 14px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("Monthly", cx, cy - 2);
  ctx.fillText("budget", cx, cy + 16);

  document.getElementById("budgetLegend").innerHTML = slices.map(slice => `
    <div class="legend-item">
      <span class="legend-label"><span class="swatch" style="background:${slice.color}"></span>${slice.label}</span>
      <strong>${money(slice.value)}</strong>
    </div>
  `).join("");
}

function drawHorizontalBarChart(canvasId, rows, options = {}) {
  const { ctx, width, height } = prepareCanvas(canvasId);
  const maxValue = options.maxValue || Math.max(...rows.map(r => r.value), 1);
  const left = 110;
  const right = 26;
  const top = 32;
  const barHeight = 28;
  const gap = 24;
  const chartWidth = width - left - right;

  ctx.font = "13px system-ui";
  ctx.textBaseline = "middle";

  rows.forEach((row, index) => {
    const y = top + index * (barHeight + gap);
    const barWidth = clamp(row.value / maxValue, 0, 1) * chartWidth;

    ctx.fillStyle = "#6b7280";
    ctx.textAlign = "right";
    ctx.fillText(row.label, left - 10, y + barHeight / 2);

    ctx.fillStyle = "#e5e7eb";
    ctx.fillRect(left, y, chartWidth, barHeight);

    ctx.fillStyle = row.color || "#2f6fed";
    ctx.fillRect(left, y, barWidth, barHeight);

    ctx.fillStyle = "#1f2937";
    ctx.textAlign = "left";
    ctx.fillText(row.display, left + Math.min(barWidth + 8, chartWidth - 60), y + barHeight / 2);
  });
}

function drawCharts(result) {
  const { values, household } = result;
  drawBudgetPie(values, household);
  drawHorizontalBarChart("burdenChart", [
    { label: "Your burden", value: household.burden * 100, display: pct(household.burden * 100), color: chartColors[0] },
    { label: "30% line", value: 30, display: "30%", color: chartColors[2] },
    { label: "50% line", value: 50, display: "50%", color: chartColors[3] }
  ], { maxValue: Math.max(60, household.burden * 100) });

  drawHorizontalBarChart("savingsChart", [
    { label: "Your savings", value: household.savingsMonths, display: `${household.savingsMonths.toFixed(1)} months`, color: chartColors[0] },
    { label: "1-month target", value: 1, display: "1 month", color: chartColors[2] },
    { label: "3-month target", value: 3, display: "3 months", color: chartColors[3] }
  ], { maxValue: Math.max(3, household.savingsMonths) });
}

plannerForm.addEventListener("submit", event => {
  event.preventDefault();

  const record = findLatestRecord();
  if (!record) {
    alert("County data are not available yet. Please run the GitHub data update workflow first.");
    return;
  }

  const values = {
    income: getNumber("income"),
    rent: getNumber("rent"),
    utilities: getNumber("utilities"),
    essentials: getNumber("essentials"),
    savings: getNumber("savings"),
    debt: getNumber("debt")
  };

  if (values.income <= 0) {
  alert("Please enter a net monthly income greater than 0.");
  return;
}

  const localStress = calculateLocalStress(record);
  const household = householdScore(values);
  const score = Math.round(finalScore(household, localStress));
  const status = classify(score);

  lastResult = { values, household, localStress, score, status, record };
  renderMainResult(lastResult);
  clearHouseholdInputs();
  resultsContainer.scrollIntoView({ behavior: "smooth", block: "start" });
});

startOverBtn.addEventListener("click", () => {
  lastResult = null;
  clearHouseholdInputs();
  preResultPanel.classList.remove("hidden");
  resultsContainer.classList.add("hidden");
  scenarioSelect.value = "no_change";
  ["customIncomeChange", "customRentChange", "customUtilityChange"].forEach(id => {
    document.getElementById(id).value = "";
  });
  customScenarioInputs.classList.add("hidden");
});

stateSelect.addEventListener("change", () => {
  fillCountyOptions();
  updateCountyContext();
});

countySelect.addEventListener("change", () => {
  updateCountyContext();
});

scenarioSelect.addEventListener("change", renderScenario);
["customIncomeChange", "customRentChange", "customUtilityChange"].forEach(id => {
  document.getElementById(id).addEventListener("input", renderScenario);
});

window.addEventListener("resize", () => {
  if (lastResult) drawCharts(lastResult);
});

loadData();
