import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowRight,
  ChevronDown,
  CloudRain,
  Droplets,
  Gauge,
  Menu,
  Minus,
  Plus,
  RotateCcw,
  Wind,
  X,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import heroImage from "../assets/monsoon-cloud-system.svg";
import lightningImage from "../assets/light.jpg";
import rainImage from "../assets/precipitation-field-illustration.svg";
import clearImage from "../assets/atmospheric-flow-illustration.svg";
import summerImage from "../assets/season-summer-science.svg";
import monsoonImage from "../assets/season-monsoon-science.svg";
import autumnImage from "../assets/season-post-monsoon-science.svg";
import winterImage from "../assets/season-winter-science.svg";
import { maharashtraDistrictPaths } from "../assets/maharashtraDistrictPaths";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RainSight — Weather Intelligence" },
      { name: "description", content: "Follow a Maharashtra monsoon forecast from model signal to ground observation in an interactive weather field journal." },
      { property: "og:title", content: "RainSight — Weather Intelligence" },
      { property: "og:description", content: "An interactive editorial field journal for forecast, rainfall and observation." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: RainSight,
});

type Theme = "cloudy" | "monsoon" | "heavy" | "clear";
const API_BASE = (import.meta.env["VITE_RAINSIGHT_API_BASE_URL"] ?? "http://127.0.0.1:5000").replace(/\/+$/, "");
const API_ROOT = `${API_BASE}/api`;

const themes: { id: Theme; name: string; note: string }[] = [
  { id: "cloudy", name: "Cloudy morning", note: "soft / diffused" },
  { id: "monsoon", name: "Active monsoon", note: "steady / humid" },
  { id: "heavy", name: "Heavy rain", note: "dense / dramatic" },
  { id: "clear", name: "Clear break", note: "fresh / sunlit" },
];

const nav: ReadonlyArray<readonly [string, string]> = [
  ["Overview", "overview"],
  ["Forecast", "forecast"],
  ["Rain field", "rain-field"],
  ["Model", "model"],
  ["History", "history"],
];

const monthLabels = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const heldOutRegimeDistribution = [
  { regime: "ACTIVE_MONSOON", days: 41, samples: 39975 },
  { regime: "BREAK_MONSOON", days: 11, samples: 10725 },
  { regime: "MONSOON_LOW_DEPRESSION", days: 39, samples: 38025 },
  { regime: "COASTAL_RAINFALL", days: 15, samples: 14625 },
  { regime: "OROGRAPHIC_RAINFALL", days: 11, samples: 10725 },
  { regime: "UNCLASSIFIED", days: 5, samples: 4875 },
] as const;
const heldOutDays = 122;
const heldOutGridSamples = 118950;
type DayForecast = { regime: string; type: "pending"; available: boolean; gfs: number | null; imd: number | null; max: number | null; humidity: number | null; pressure: number | null };
type ModelOutput = { correctedRainMm: number; regime: string | null };
type RainGridPoint = { latitude: number; longitude: number; gfs: number; aiCorrected: number; imd: number; heavyRainProbability?: number };
type ApiRainGrid = { columns: number; points: number; rows: Array<RainGridPoint | RainGridPoint[]> };
type RainGridField = "gfs" | "aiCorrected" | "imd" | "error";
type ApiForecast = {
  date?: string;
  regime?: string | null;
  regimeStatus?: string | null;
  regimeSource?: string | null;
  regimeReason?: string | null;
  modelSource?: string | null;
  rawGfs?: { mean?: number | null; max?: number | null };
  imdObserved?: { mean?: number | null; max?: number | null };
  aiCorrected?: { mean?: number | null; max?: number | null };
  atmosphericModel?: { mean?: number | null; max?: number | null };
  heavyRainGridFractionPercent?: number | null;
  heavyRainProbability?: { meanGridCellPercent?: number | null; model?: string; thresholdMmDay?: number; status?: "TRAINING_PERIOD_OUTPUT" | "HELD_OUT_2024_PREDICTION" | string } | null;
  atmosphericFeatures?: {
    capeJkg?: number | null;
    rh2mPercent?: number | null;
    mslpHpa?: number | null;
    uWind10mMs?: number | null;
    vWind10mMs?: number | null;
  } | null;
  rainfallGrid?: RainGridPoint[];
  grid?: ApiRainGrid;
};
type VerificationResponse = {
  metrics?: {
    rawGfs?: Partial<Record<"mae" | "rmse" | "csi" | "pod" | "far" | "fss", number | null>>;
    aiCorrected?: Partial<Record<"mae" | "rmse" | "csi" | "pod" | "far" | "fss", number | null>>;
    atmosphericModel?: Partial<Record<"mae" | "rmse" | "csi" | "pod" | "far" | "fss", number | null>>;
  };
  testPeriod?: string;
  testRows?: number;
  testDays?: number;
  trainingPeriod?: string;
  thresholdMmDay?: number;
};
type AvailableDates = { "2023": string[]; "2024": string[] };

function hasUsableRainGrid(forecast: ApiForecast | null, expectedDate: string): forecast is ApiForecast & { rainfallGrid: RainGridPoint[] } {
  return Boolean(forecast && (!forecast.date || forecast.date === expectedDate) && Array.isArray(forecast.rainfallGrid) && forecast.rainfallGrid.length > 0 && forecast.rainfallGrid.every((point) =>
    [point.latitude, point.longitude, point.gfs, point.aiCorrected, point.imd].every(Number.isFinite),
  ));
}

function normalizeApiForecast(forecast: ApiForecast, requestedDate: string): ApiForecast {
  const gridRows = forecast.grid?.rows;
  const grid = Array.isArray(gridRows) && gridRows.length
    ? gridRows.flatMap((row) => Array.isArray(row) ? row : [row])
    : forecast.rainfallGrid ?? [];
  return {
    ...forecast,
    date: forecast.date ?? requestedDate,
    rainfallGrid: (grid ?? []).map((cell) => ({
      latitude: Number(cell.latitude),
      longitude: Number(cell.longitude),
      gfs: Number(cell.gfs),
      aiCorrected: Number(cell.aiCorrected),
      imd: Number(cell.imd),
      ...(Number.isFinite(cell.heavyRainProbability) && cell.heavyRainProbability >= 0 && cell.heavyRainProbability <= 1 ? { heavyRainProbability: Number(cell.heavyRainProbability) } : {}),
    })),
  };
}

function isoDate(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function dateLabel(date: Date) { return Number.isNaN(date.getTime()) ? "LOADING ARCHIVE" : date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase(); }
function showValue(value: number | null, unit = ""): string { return value === null ? "PENDING" : `${value}${unit}`; }
type DailyMetrics = { mae: number; rmse: number; bias: number; pod: number; far: number; csi: number };
function dailyMetrics(grid: RainGridPoint[] | undefined, forecastField: "gfs" | "aiCorrected", threshold: number): DailyMetrics | null {
  const samples = (grid ?? []).filter((point) => [point[forecastField], point.imd].every(Number.isFinite));
  if (samples.length === 0) return null;
  let absoluteError = 0, squaredError = 0, signedError = 0, hits = 0, misses = 0, falseAlarms = 0;
  for (const point of samples) {
    const predicted = point[forecastField];
    const error = predicted - point.imd;
    absoluteError += Math.abs(error);
    squaredError += error * error;
    signedError += error;
    const forecastRain = predicted > threshold;
    const observedRain = point.imd > threshold;
    if (forecastRain && observedRain) hits++;
    else if (!forecastRain && observedRain) misses++;
    else if (forecastRain && !observedRain) falseAlarms++;
  }
  return {
    mae: absoluteError / samples.length,
    rmse: Math.sqrt(squaredError / samples.length),
    bias: signedError / samples.length,
    pod: hits + misses === 0 ? 0 : hits / (hits + misses),
    far: hits + falseAlarms === 0 ? 0 : falseAlarms / (hits + falseAlarms),
    csi: hits + misses + falseAlarms === 0 ? 0 : hits / (hits + misses + falseAlarms),
  };
}
function regimeLabel(regime: string | null | undefined): string {
  const labels: Record<string, string> = {
    ACTIVE_MONSOON: "ACTIVE MONSOON",
    BREAK_MONSOON: "BREAK MONSOON",
    MONSOON_LOW_DEPRESSION: "MONSOON LOW / DEPRESSION",
    COASTAL_RAINFALL: "COASTAL RAINFALL",
    OROGRAPHIC_RAINFALL: "OROGRAPHIC RAINFALL",
    UNCLASSIFIED: "UNCLASSIFIED",
  };
  return regime ? labels[regime] ?? regime.replaceAll("_", " ") : "PENDING";
}

function ArchiveDateSelector({ selectedDate, calendarMonth, availableDates, archiveLoading, onYearChange, onMonthChange, onSelect, onRetryArchive }: {
  selectedDate: string;
  calendarMonth: string;
  availableDates: AvailableDates;
  archiveLoading: boolean;
  onYearChange: (year: "2023" | "2024") => void;
  onMonthChange: (month: string) => void;
  onSelect: (date: string) => void;
  onRetryArchive: () => void;
}) {
  const year = calendarMonth.slice(0, 4) === "2024" ? "2024" : "2023";
  const yearDates = availableDates[year];
  const availableMonths = [...new Set(yearDates.map((date) => date.slice(0, 7)))].sort();
  const monthDate = new Date(`${calendarMonth}-01T12:00:00`);
  const firstWeekday = (new Date(monthDate.getFullYear(), monthDate.getMonth(), 1).getDay() + 6) % 7;
  const monthDates = yearDates.filter((date) => date.startsWith(calendarMonth));
  return <div className="archive-date-controls" aria-label="Choose an available forecast date">
    <div className="calendar-toolbar"><span>YEAR</span><div className="calendar-year">{(["2023", "2024"] as const).map((option) => <button key={option} type="button" className={year === option ? "selected" : ""} aria-pressed={year === option} onClick={() => onYearChange(option)}>{option}</button>)}</div><span className="calendar-month-label">MONTH</span><div className="calendar-months">{availableMonths.map((month) => { const index = Number(month.slice(5, 7)) - 1; return <button key={month} type="button" className={month === calendarMonth ? "selected" : ""} aria-pressed={month === calendarMonth} onClick={() => onMonthChange(month)}>{monthLabels[index]}</button>; })}</div></div>
    <div className="calendar-grid" role="group" aria-label={`${monthLabels[monthDate.getMonth()]} ${year} available dates`}>{["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((day) => <span className="weekday" key={day}>{day}</span>)}{Array.from({ length: firstWeekday }, (_, index) => <span className="calendar-empty" key={`empty-${index}`} />)}{monthDates.map((iso) => { const day = Number(iso.slice(8, 10)); return <button key={iso} type="button" className={`calendar-day ${selectedDate === iso ? "selected" : ""}`} onClick={() => onSelect(iso)} aria-pressed={selectedDate === iso} title="Source forecast data available"><b>{String(day).padStart(2, "0")}</b><small>AVAILABLE</small></button>; })}</div>
    {archiveLoading && <p className="calendar-note" role="status">Loading available archive dates…</p>}
    {!archiveLoading && availableDates["2023"].length + availableDates["2024"].length === 0 && <p className="calendar-note" role="alert">Available dates could not be loaded. <button type="button" onClick={onRetryArchive}>Retry</button></p>}
  </div>;
}

function RainSight() {
  const [theme, setTheme] = useState<Theme>("monsoon");
  const [themeOpen, setThemeOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [active, setActive] = useState("overview");
  const [selectedDate, setSelectedDate] = useState("");
  const [availableDates, setAvailableDates] = useState<AvailableDates>({ "2023": [], "2024": [] });
  const [calendarMonth, setCalendarMonth] = useState("2023-06");
  const [archiveLoading, setArchiveLoading] = useState(true);
  const [archiveRequestId, setArchiveRequestId] = useState(0);
  const [apiForecast, setApiForecast] = useState<ApiForecast | null>(null);
  const [forecastLoading, setForecastLoading] = useState(true);
  const [forecastError, setForecastError] = useState(false);
  const [forecastRequestId, setForecastRequestId] = useState(0);
  const [verification, setVerification] = useState<VerificationResponse | null>(null);
  const selected = new Date(`${selectedDate}T12:00:00`);
  const validDates = new Set([...availableDates["2023"], ...availableDates["2024"]]);

  const forecast: DayForecast = {
    regime: apiForecast?.regime ?? "PENDING",
    type: "pending",
    available: apiForecast !== null,
    gfs: apiForecast?.rawGfs?.mean ?? null,
    imd: apiForecast?.imdObserved?.mean ?? null,
    max: apiForecast?.imdObserved?.max ?? null,
    humidity: apiForecast?.atmosphericFeatures?.rh2mPercent ?? null,
    pressure: apiForecast?.atmosphericFeatures?.mslpHpa ?? null,
  };

  const aiModelOutput: ModelOutput | null =
    typeof apiForecast?.aiCorrected?.mean === "number"
      ? { correctedRainMm: apiForecast.aiCorrected.mean, regime: apiForecast.regime ?? null }
      : null;

  const heavyRainThreshold = 64.5;
  const verificationThreshold = verification?.thresholdMmDay ?? 64.5;
  const appliedDateForecast = !forecastLoading && !forecastError && hasUsableRainGrid(apiForecast, selectedDate)
    ? apiForecast
    : null;
  const heavyRainGridFractionPercent: number | null = appliedDateForecast?.rainfallGrid.length
    ? appliedDateForecast.rainfallGrid.filter((point) => Number(point.aiCorrected) >= heavyRainThreshold).length / appliedDateForecast.rainfallGrid.length * 100
    : null;
  const rawDailyMetrics = dailyMetrics(apiForecast?.rainfallGrid, "gfs", verificationThreshold);
  const correctedDailyMetrics = dailyMetrics(apiForecast?.rainfallGrid, "aiCorrected", verificationThreshold);
  const showDashboardValue = (value: number | null, unit = "") => forecastLoading ? "LOADING" : forecastError ? "UNAVAILABLE" : showValue(value, unit);
  const currentRegime = regimeLabel(apiForecast?.regime);
  const currentRegimeStatus = forecastLoading ? "LOADING" : forecastError ? "UNAVAILABLE" : apiForecast?.regimeStatus === "PROTOTYPE_RULE_BASED" ? "PROTOTYPE · RULE BASED" : "PENDING";
  const regimeNames = ["ACTIVE_MONSOON", "BREAK_MONSOON", "MONSOON_LOW_DEPRESSION", "COASTAL_RAINFALL", "OROGRAPHIC_RAINFALL"];

  useEffect(() => {
    let currentRequest = true;
    setArchiveLoading(true);
    fetch(`${API_ROOT}/available-dates`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Available dates API request failed")))
      .then((data: Partial<AvailableDates>) => {
        if (!currentRequest) return;
        const isoPattern = /^202[34]-(06|07|08|09)-(0[1-9]|[12]\d|3[01])$/;
        const isRealDate = (date: string) => {
          if (!isoPattern.test(date)) return false;
          const parsed = new Date(`${date}T12:00:00`);
          return isoDate(parsed) === date;
        };
        const dates: AvailableDates = {
          "2023": Array.isArray(data["2023"]) ? data["2023"].filter((date): date is string => typeof date === "string" && date.startsWith("2023-") && isRealDate(date)).sort() : [],
          "2024": Array.isArray(data["2024"]) ? data["2024"].filter((date): date is string => typeof date === "string" && date.startsWith("2024-") && isRealDate(date)).sort() : [],
        };
        setAvailableDates(dates);
        const initial = dates["2024"].includes("2024-07-16") ? "2024-07-16" : dates["2024"][0] ?? dates["2023"][0] ?? "";
        if (initial) {
          setSelectedDate(initial);
          setCalendarMonth(initial.slice(0, 7));
        }
        setArchiveLoading(false);
      })
      .catch(() => { if (currentRequest) { setAvailableDates({ "2023": [], "2024": [] }); setArchiveLoading(false); } });
    return () => { currentRequest = false; };
  }, [archiveRequestId]);

  useEffect(() => {
    let currentRequest = true;
    if (!validDates.has(selectedDate)) {
      setApiForecast(null);
      setForecastLoading(false);
      setForecastError(false);
      return () => { currentRequest = false; };
    }
    setApiForecast(null);
    setForecastLoading(true);
    setForecastError(false);
    fetch(`${API_ROOT}/forecast?date=${encodeURIComponent(selectedDate)}`)
      .then((response) => {
        if (!response.ok) throw new Error("Forecast API request failed");
        return response.json();
      })
      .then((data: ApiForecast) => {
        const normalizedForecast = normalizeApiForecast(data, selectedDate);
        if (!hasUsableRainGrid(normalizedForecast, selectedDate)) throw new Error("Forecast API did not return a usable rainfall grid for the selected date");
        if (currentRequest && import.meta.env.DEV) {
          const qualifyingCells = normalizedForecast.rainfallGrid.filter((cell) => Number(cell.aiCorrected) >= 64.5).length;
          console.info("[RainSight] Heavy-rain grid extent", {
            date: selectedDate,
            rawResponseGridCellCount: data.grid?.points ?? 0,
            normalizedGridCellCount: normalizedForecast.rainfallGrid.length,
            gridCellCount: normalizedForecast.rainfallGrid.length,
            qualifyingAiCorrectedCellCount: qualifyingCells,
            fractionPercent: qualifyingCells / normalizedForecast.rainfallGrid.length * 100,
          });
        }
        if (currentRequest) { setApiForecast(normalizedForecast); setForecastLoading(false); }
      })
      .catch(() => {
        if (currentRequest) { setApiForecast(null); setForecastLoading(false); setForecastError(true); }
      });
    return () => {
      currentRequest = false;
    };
  }, [selectedDate, availableDates, forecastRequestId]);

  useEffect(() => {
    let currentRequest = true;
    fetch(`${API_ROOT}/verification`)
      .then((response) => {
        if (!response.ok) throw new Error("Verification API request failed");
        return response.json();
      })
      .then((data: VerificationResponse) => {
        if (currentRequest) setVerification(data);
      })
      .catch(() => {
        if (currentRequest) setVerification(null);
      });
    return () => {
      currentRequest = false;
    };
  }, []);
  const chooseDate = (iso: string) => {
    if (!validDates.has(iso) || iso === selectedDate) return;
    setApiForecast(null);
    setForecastLoading(true);
    setForecastError(false);
    setSelectedDate(iso);
  };
  const changeYear = (year: "2023" | "2024") => {
    const months = [...new Set(availableDates[year].map((day) => day.slice(0, 7)))].sort();
    const preferredMonth = `${year}-${calendarMonth.slice(5, 7)}`;
    const nextMonth = months.includes(preferredMonth) ? preferredMonth : months[0];
    const datesInMonth = nextMonth ? availableDates[year].filter((day) => day.startsWith(nextMonth)).sort() : [];
    const preferredDate = nextMonth ? `${nextMonth}-${selectedDate.slice(8, 10)}` : "";
    const nextDate = datesInMonth.includes(preferredDate) ? preferredDate : datesInMonth[0];
    if (nextMonth && nextDate) {
      setCalendarMonth(nextMonth);
      chooseDate(nextDate);
    }
  };
  const changeMonth = (month: string) => {
    const year = month.slice(0, 4) as "2023" | "2024";
    const datesInMonth = availableDates[year].filter((day) => day.startsWith(month)).sort();
    if (datesInMonth.length === 0) return;
    setCalendarMonth(month);
    if (!datesInMonth.includes(selectedDate)) chooseDate(datesInMonth[0]!);
  };

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.isIntersecting && setActive(entry.target.id)),
      { rootMargin: "-35% 0px -55%" },
    );
    document.querySelectorAll("section[id]").forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  const go = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    setMobileOpen(false);
  };

  return (
    <main data-weather={theme} className="weather-world">
      <Header active={active} theme={theme} themeOpen={themeOpen} mobileOpen={mobileOpen} date={selected} setTheme={setTheme} setThemeOpen={setThemeOpen} setMobileOpen={setMobileOpen} go={go} />

      <section id="overview" className="hero section-shell">
        <div className="weather-stamp">MAHARASHTRA · {dateLabel(selected)} · 18.52°N / 73.85°E</div>
        <div className="hero-copy">
          <p className="kicker"><span>01</span> The forecast</p>
          <h1>WHAT DID<br /><i>THE FORECAST</i><br />SEE?</h1>
          <p className="hero-model-label">RAINFALL AI · REGIME-AWARE FORECAST CORRECTION</p>
          <p className="lede">RainSight learns regime-dependent rainfall corrections from historical NWP forecasts and IMD observations.</p>
          <div className="hero-ctas"><button className="hero-cta-primary" onClick={() => go("forecast")}>EXPLORE THE FORECAST <ArrowRight size={16} /></button><button className="hero-cta-secondary" onClick={() => go("model")}>SEE THE SCIENCE <ArrowDown size={15} /></button></div>
          <div className="forecast-start">
            <ArchiveDateSelector selectedDate={selectedDate} calendarMonth={calendarMonth} availableDates={availableDates} archiveLoading={archiveLoading} onYearChange={changeYear} onMonthChange={changeMonth} onSelect={chooseDate} onRetryArchive={() => setArchiveRequestId((value) => value + 1)} />
            <p className="forecast-date-summary" aria-live="polite">{selectedDate ? `Viewing forecast for ${dateLabel(selected)}.` : archiveLoading ? "Loading available forecast dates…" : "No forecast data available for this date."}</p>
            <small>All forecast sections update for this source date · 2023 training archive · 2024 held-out archive.</small>
          </div>
        </div>
        <div className="hero-frame paper-card">
          <span className="side-tab">FIELD NOTE 01</span>
          <div className="number-pin">01</div>
          <img className="hero-storm-art" src={lightningImage} alt="Lightning over a rain-soaked road beneath storm clouds" />
          <div className="photo-caption"><b>LIGHTNING STORM</b><span>Storm over a rain-soaked road</span></div>
        </div>
        <span className="hand-note hero-note">look closer.</span>
        <div className="scroll-cue"><span>FOLLOW THE SIGNAL</span><ArrowDown size={16} /></div>
      </section>

      <section id="forecast" className="story section-shell ruled-top reveal-section">
        <SectionTitle number="02" eyebrow="Anatomy of an event" lines={["ONE WEATHER EVENT.", "MANY SIGNALS."]} />
        <div className="story-collage">
          <StoryCard className="story-one" number="01" label="Forecast · GFS" title="What the model saw" value={showDashboardValue(forecast.gfs, " mm")} note="GFS spatial mean" icon={<CloudRain />} image={heroImage} />
          <StoryCard className="story-two" number="02" label="Atmosphere · GFS" title="What the air was doing" value={showDashboardValue(forecast.humidity, "%")} note="GFS relative humidity at 2 m" icon={<Wind />} />
          <StoryCard className="story-three" number="03" label="Rainfall · IMD" title="What reached the ground" value={showDashboardValue(forecast.max, " mm")} note="IMD observed maximum" icon={<Droplets />} image={rainImage} />
          <StoryCard className="story-four" number="04" label="Observation · IMD" title="What IMD observed" value={showDashboardValue(forecast.imd, " mm")} note="IMD observed mean" icon={<Gauge />} />
        </div>
      </section>

      <section className="three-views section-shell ink-band reveal-section">
        <SectionTitle number="03" eyebrow="Comparative plates" lines={["ONE FORECAST.", "THREE VIEWS."]} light />
        <p className="section-intro light-copy">Three instruments. One weather event.</p>
        <div className="plate-layout">
          <WeatherPlate number="01" title="RAW GFS" subtitle="Precipitation field" value={showDashboardValue(forecast.gfs)} unit="mm mean" status="GFS INPUT" mode="raw" field="gfs" gridValues={apiForecast?.rainfallGrid} hasData={forecast.gfs !== null} />
          <WeatherPlate number="02" title="AI CORRECTED" subtitle={aiModelOutput ? `REGIME: ${regimeLabel(aiModelOutput.regime)}` : "AI corrected rainfall"} value={aiModelOutput ? String(aiModelOutput.correctedRainMm) : forecastError ? "UNAVAILABLE" : forecastLoading ? "LOADING" : "PENDING"} unit={aiModelOutput ? "mm mean" : forecastError ? "" : "not connected"} status={aiModelOutput ? "REGIME-AWARE RF OUTPUT" : forecastError ? "FORECAST UNAVAILABLE" : forecastLoading ? "LOADING" : "AWAITING MODEL"} mode={aiModelOutput ? "corrected" : "pending"} field="aiCorrected" gridValues={apiForecast?.rainfallGrid} hasData={aiModelOutput !== null} />
          <WeatherPlate number="03" title="IMD OBSERVED" subtitle="Rainfall reference" value={showDashboardValue(forecast.imd)} unit="mm mean" status="IMD REFERENCE DATA" mode="observed" field="imd" gridValues={apiForecast?.rainfallGrid} hasData={forecast.imd !== null} />
        </div>
        <RainfallLegend />
        <p className="data-note" role={forecastError ? "alert" : undefined} aria-live="polite">{forecastLoading ? "Loading forecast…" : forecastError ? <>Forecast unavailable for this date. <button type="button" onClick={() => { setForecastError(false); setForecastLoading(true); setForecastRequestId((value) => value + 1); }}>Retry</button></> : forecast.gfs === null ? `Forecast unavailable for ${dateLabel(selected)}.` : `GFS input, IMD reference and regime-aware Random Forest output come from the ${selected.getFullYear()} ${selected.getFullYear() === 2023 ? "training" : "held-out test"} dataset for ${dateLabel(selected)}. Regime: ${currentRegime}.`}</p>
        <HeavyRainExtent probabilityPercent={apiForecast?.heavyRainProbability?.meanGridCellPercent ?? null} fractionPercent={heavyRainGridFractionPercent} threshold={apiForecast?.heavyRainProbability?.thresholdMmDay ?? heavyRainThreshold} model={apiForecast?.heavyRainProbability?.model ?? null} evaluationStatus={apiForecast?.heavyRainProbability?.status ?? null} />
      </section>

      <section id="model" className="signal-section section-shell reveal-section">
        <SectionTitle number="04" eyebrow="Model journey" lines={["FOLLOW", "THE SIGNAL."]} />
        <div className="signal-path">
          {[
            ["NWP INPUT", "GFS · verified source grid"],
            ["ATMOSPHERIC FEATURES", "Rain · CAPE · RH · MSLP · wind"],
            ["REGIME CLASSIFICATION", currentRegimeStatus],
            ["REGIME-AWARE RANDOM FOREST", apiForecast?.modelSource ?? (forecastError ? "Forecast unavailable" : forecastLoading ? "Loading forecast…" : "PENDING")],
            ["CORRECTED RAINFALL", apiForecast?.modelSource ? "2023-trained model · applied across the available archive" : forecastError ? "Forecast unavailable" : "PENDING"],
            ["GRID EXTENT", "Share of corrected grid cells ≥ 64.5 mm/day"],
            ["IMD OBSERVATION", "Paired reference grid · local archive"],
            ["VERIFICATION", "Test-set evaluation · 2024 held-out"],
          ].map(([item, detail], i) => (
            <div className="signal-stop" key={item}>
              <span className="signal-index">{String(i + 1).padStart(2, "0")}</span>
              <span className="signal-dot" />
              <b>{item}</b>
              <small>{detail}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="regime-section section-shell reveal-section">
        <SectionTitle number="05" eyebrow="Weather regime" lines={["THE WEATHER", "REGIME."]} />
        <p className="regime-subtitle">THE ATMOSPHERE CHANGES THE CORRECTION.</p>
        <div className="regime-layout">
          <article className="regime-card paper-card">
            <div className="regime-card-head"><span>REGIME CLASSIFIER</span><b className="status pending">{currentRegimeStatus}</b></div>
            <div className="regime-readout"><small>REGIME OUTPUT · {dateLabel(selected)}</small><h3>{forecastLoading ? "LOADING" : forecastError ? "UNAVAILABLE" : currentRegime}</h3></div>
            <div className="regime-flow"><div><small>CORRECTION PATH</small><b>{apiForecast?.modelSource ? "ATMOSPHERE + FROZEN REGIME → RF" : forecastError ? "FORECAST UNAVAILABLE" : forecastLoading ? "LOADING FORECAST…" : "PENDING"}</b></div><span>{apiForecast?.regimeSource ?? (forecastError ? "NO CURRENT RESPONSE" : "AWAITING BACKEND RESPONSE")}</span></div>
            <div className="regime-confidence"><span>CLASSIFIER</span><b>{forecastError ? "UNAVAILABLE" : apiForecast?.regimeStatus === "PROTOTYPE_RULE_BASED" ? "PROTOTYPE RULE-BASED" : forecastLoading ? "LOADING" : "PENDING"}</b></div>
            <p role={forecastError ? "alert" : undefined}>{forecastError ? "Forecast unavailable for this date." : apiForecast?.regimeReason ?? (forecastLoading ? "Loading forecast…" : "The backend has not returned a regime for this date.")}</p>
          </article>
          <div className="regime-list"><span className="regime-list-title">PROTOTYPE REGIME PATHS · {currentRegimeStatus}</span>{regimeNames.map((name, index) => { const isCurrent = apiForecast?.regime === name; return <div className="regime-list-row" key={name}><span>{String(index + 1).padStart(2, "0")}</span><b>{regimeLabel(name)}</b><small>{forecastLoading ? "LOADING" : forecastError ? "UNAVAILABLE" : isCurrent ? "CURRENT" : "NOT CURRENT"}</small></div>; })}{apiForecast?.regime === "UNCLASSIFIED" && <div className="regime-list-row"><span>06</span><b>UNCLASSIFIED</b><small>CURRENT</small></div>}</div>
        </div>
      </section>

      <section className="instruments section-shell reveal-section">
        <div className="instrument-copy">
          <SectionTitle number="06" eyebrow="Atmospheric evidence" lines={["WHAT INFORMED", "THE CORRECTION?"]} />
          <p>WEATHER MODELS DO NOT SEE THE ATMOSPHERE AS A SINGLE NUMBER. THEY READ SIGNALS.</p>
          <span className="hand-note">atmospheric inputs.</span>
        </div>
        <div className="instrument-paper paper-card">
          <div className="paper-header"><span>GFS ATMOSPHERIC FEATURES · SELECTED DATE</span><b>{apiForecast?.atmosphericFeatures ? "GFS" : "PENDING"}</b></div>
          <Instrument label="RELATIVE HUMIDITY · 2 M" value={showValue(apiForecast?.atmosphericFeatures?.rh2mPercent ?? null, "%")} position={50} marks="GFS" />
          <Instrument label="MSLP" value={showValue(apiForecast?.atmosphericFeatures?.mslpHpa ?? null, " hPa")} position={50} marks="GFS" />
          <Instrument label="U WIND · 10 M" value={showValue(apiForecast?.atmosphericFeatures?.uWind10mMs ?? null, " m/s")} position={50} marks="GFS" />
          <Instrument label="V WIND · 10 M" value={showValue(apiForecast?.atmosphericFeatures?.vWind10mMs ?? null, " m/s")} position={50} marks="GFS" />
          <Instrument label="CAPE" value={showValue(apiForecast?.atmosphericFeatures?.capeJkg ?? null, " J/kg")} position={50} marks="GFS" />
          <div className="classifier-bridge"><b>REGIME CLASSIFIER</b><span>↓</span><b>{forecastError ? "UNAVAILABLE" : forecastLoading ? "LOADING" : `DETECTED · ${currentRegime}`}</b></div>
          <span className="hand-note instrument-note">follow the signal →</span>
        </div>
      </section>

      <section id="rain-field" className="map-section section-shell ruled-top reveal-section">
        <div className="map-heading">
        <SectionTitle number="07" eyebrow="Spatial exploration" lines={["THE RAIN", "FIELD."]} />
          <p>Rain is never evenly distributed. Explore the rainfall field across Maharashtra.</p>
        </div>
        <MaharashtraMap dateId={selectedDate} forecast={apiForecast} loading={forecastLoading} unavailable={forecastError} />
      </section>

      <section className="error-section section-shell ink-band reveal-section">
        <SectionTitle number="08" eyebrow="Difference study" lines={["WHERE DID", "THE FORECAST", "MISS?"]} light />
        <div className="equation-sheets">
          <MiniMap title="REGIME-AWARE RF · FINAL" supportingText={`2023-TRAINED · SELECTED DATE · ${dateLabel(selected)}`} pattern="corrected" field="aiCorrected" gridValues={apiForecast?.rainfallGrid} value={forecastLoading ? "LOADING" : forecastError ? "UNAVAILABLE" : apiForecast?.aiCorrected?.mean == null ? "PENDING" : `${apiForecast.aiCorrected.mean.toFixed(2)} mm`} />
          <span className="math-mark">−</span>
          <MiniMap title="IMD OBSERVED" supportingText={`RAINFALL REFERENCE · ${dateLabel(selected)}`} pattern="imd" field="imd" gridValues={apiForecast?.rainfallGrid} value={forecastLoading ? "LOADING" : forecastError ? "UNAVAILABLE" : forecast.imd === null ? "PENDING" : `${forecast.imd} mm`} />
          <span className="math-mark">=</span>
          <MiniMap title="SIGNED ERROR · AI − IMD" supportingText={`SAME SELECTED DATE · ${dateLabel(selected)}`} pattern="error" field="error" gridValues={apiForecast?.rainfallGrid} value={forecastLoading ? "LOADING" : forecastError ? "UNAVAILABLE" : apiForecast?.rainfallGrid ? "GRID DIFFERENCE · MM" : "PENDING"} />
        </div>
        <div className="error-model-sequence"><span>RAW NWP</span><i>→</i><span>RAINFALL-ONLY RF</span><i>→</i><b>REGIME-AWARE RF · FINAL</b></div>
        <div className="error-metric-comparison" aria-label={`Selected-date MAE and RMSE comparison for ${dateLabel(selected)}`}>
          <article className="error-metric-group">
            <div className="error-metric-heading"><b>MAE</b><span>SELECTED DATE · MM</span></div>
            <div className="error-metric-row"><span>RAW GFS</span><b>{forecastLoading ? "LOADING" : forecastError ? "UNAVAILABLE" : rawDailyMetrics ? `${rawDailyMetrics.mae.toFixed(3)} mm` : "NO GRID DATA"}</b></div>
            <div className="error-metric-row final"><span>REGIME-AWARE RF · FINAL</span><b>{forecastLoading ? "LOADING" : forecastError ? "UNAVAILABLE" : correctedDailyMetrics ? `${correctedDailyMetrics.mae.toFixed(3)} mm` : "NO GRID DATA"}</b></div>
          </article>
          <article className="error-metric-group">
            <div className="error-metric-heading"><b>RMSE</b><span>SELECTED DATE · MM</span></div>
            <div className="error-metric-row"><span>RAW GFS</span><b>{forecastLoading ? "LOADING" : forecastError ? "UNAVAILABLE" : rawDailyMetrics ? `${rawDailyMetrics.rmse.toFixed(3)} mm` : "NO GRID DATA"}</b></div>
            <div className="error-metric-row final"><span>REGIME-AWARE RF · FINAL</span><b>{forecastLoading ? "LOADING" : forecastError ? "UNAVAILABLE" : correctedDailyMetrics ? `${correctedDailyMetrics.rmse.toFixed(3)} mm` : "NO GRID DATA"}</b></div>
          </article>
        </div>
        <div className="error-model-journey">
          <b>REGIME-AWARE RF · FINAL</b>
          <span>TRAINED: JUN–SEP 2023</span>
          <span>HELD-OUT: JUN–SEP 2024</span>
          <span>122 DAYS · 118,950 GRID SAMPLES</span>
        </div>
        <div className="error-what-changed">
          <b className="error-what-title">WHAT CHANGED?</b>
          <div><b>RAW NWP</b><span>Uncorrected numerical rainfall forecast</span></div>
          <div><b>RAINFALL-ONLY RF</b><span>Baseline machine-learning correction</span></div>
          <div><b>REGIME-AWARE RF</b><span>Correction conditioned on detected monsoon regime and atmospheric predictors</span></div>
          <div><b>IMD OBSERVED</b><span>Held-out rainfall reference</span></div>
        </div>
        <p className="data-note">All three spatial fields use the selected date, Maharashtra grid and spatial extent. Signed error is AI corrected rainfall minus IMD observed rainfall.</p>
      </section>

      <section id="verification" className="verification section-shell reveal-section">
        <div className="verification-heading">
          <SectionTitle number="09" eyebrow="Selected-date verification" lines={["DID THE FORECAST", "GET IT RIGHT?"]} />
          <p className="verification-subtitle">PAIRED GRID SCORES FOR {dateLabel(selected)}</p>
        </div>
        <div className="verification-layout">
          <article className="verification-results paper-card">
            <div className="verification-panel-heading"><b>SELECTED-DATE DIAGNOSTIC</b><span>{forecastLoading ? "LOADING" : forecastError ? "UNAVAILABLE" : `${apiForecast?.rainfallGrid?.length ?? 0} PAIRED GRID CELLS`}</span></div>
            <div className="verification-grid-wrap"><div className="verification-grid"><span>METRIC</span><b>RAW GFS</b><b>REGIME-AWARE RF · FINAL</b><b>THRESHOLD</b>
              {(["MAE", "RMSE", "BIAS", "POD", "FAR", "CSI"] as const).map((metric) => {
                const rawValue = rawDailyMetrics?.[metric.toLowerCase() as keyof DailyMetrics];
                const correctedValue = correctedDailyMetrics?.[metric.toLowerCase() as keyof DailyMetrics];
                const format = (value: number | undefined) => forecastLoading ? "LOADING" : forecastError ? "UNAVAILABLE" : value === undefined ? "NO GRID DATA" : metric === "MAE" || metric === "RMSE" || metric === "BIAS" ? `${value.toFixed(3)} mm` : value.toFixed(3);
                return <Fragment key={metric}><strong>{metric}</strong><span>{format(rawValue)}</span><span>{format(correctedValue)}</span><span>{metric === "POD" || metric === "FAR" || metric === "CSI" ? `${verificationThreshold} mm/day` : "—"}</span></Fragment>;
              })}
            </div></div>
            <p className="table-footnote">Scores are recomputed from the selected date’s paired GFS, AI-corrected and IMD grid values. Rain events use the project threshold of {verificationThreshold} mm/day. Bias is forecast minus IMD.</p>
          </article>
          <aside className="verification-context">
            <div className="verification-context-head"><span>FINAL HELD-OUT EVALUATION</span><b>2024<br />HELD-OUT</b></div>
            <div className="verification-stat-pair">
              <div><span>TEST DAYS</span><b>{heldOutDays.toLocaleString("en-US")}</b></div>
              <div><span>GRID SAMPLES</span><b>{heldOutGridSamples.toLocaleString("en-US")}</b></div>
            </div>
            <div className="regime-distribution">
              <div className="regime-distribution-heading"><b>REGIME DISTRIBUTION</b><span>2024 HELD-OUT CLASSIFICATION</span></div>
              <div className="regime-distribution-legend">CLASSIFIED DAYS · GRID SAMPLES</div>
              {heldOutRegimeDistribution.map(({ regime, days, samples }) => {
                const width = days / 41 * 100;
                return <div className="regime-distribution-row" key={regime}>
                  <div className="regime-distribution-label"><b>{regimeLabel(regime)}</b><span>{days} DAYS · {samples.toLocaleString("en-US")} GRID SAMPLES</span></div>
                  <div className="regime-distribution-track" aria-hidden="true"><i style={{ width: `${width}%` }} /></div>
                </div>;
              })}
              <div className="regime-distribution-total"><b>TOTAL</b><span>{heldOutDays} DAYS · {heldOutGridSamples.toLocaleString("en-US")} GRID SAMPLES</span></div>
              <div className="regime-classification-note"><b>CLASSIFICATION DATA AVAILABLE</b><span>122 held-out days classified using the frozen 2023-derived regime rules.</span></div>
              <div className="regime-metrics-note"><b>REGIME-WISE VERIFICATION METRICS</b><span>Not available in the current evaluation artifact.</span></div>
            </div>
          </aside>
        </div>
        <div className="data-provenance">
          <b>DATA PROVENANCE</b>
          <span><small>DATA SOURCES</small>GFS / NWP rainfall · IMD observations</span>
          <span><small>TRAINING</small>June–September 2023</span>
          <span><small>HELD-OUT TEST</small>June–September 2024</span>
          <span><small>SPATIAL RESOLUTION</small>0.25°</span>
          <span><small>REGION</small>Maharashtra spatial subset</span>
          <span><small>MODEL</small>Regime-Aware Random Forest</span>
          <span><small>HEAVY-RAIN THRESHOLD</small>{verification?.thresholdMmDay ?? 64.5} mm/day</span>
        </div>
      </section>

      <section id="history" className="memory section-shell ruled-top reveal-section">
        <SectionTitle number="10" eyebrow="Forecast memory" lines={["WHAT DID THE MODEL", "SEE BEFORE?"]} />
        <div className="date-archive">
          <div className="calendar-sheet paper-card">
            <div className="calendar-topline"><span>CHOOSE A DATE · CURRENTLY SHARED ACROSS THE FORECAST</span></div>
            <ArchiveDateSelector selectedDate={selectedDate} calendarMonth={calendarMonth} availableDates={availableDates} archiveLoading={archiveLoading} onYearChange={changeYear} onMonthChange={changeMonth} onSelect={chooseDate} onRetryArchive={() => setArchiveRequestId((value) => value + 1)} />
            <p className="calendar-note" aria-live="polite">Selected forecast date: {dateLabel(selected)} · changes load immediately across all forecast sections.</p>
          </div>
          <aside className="date-reading paper-card">
            <span className="reading-overline">SELECTED DATE · RAINFALL ARCHIVE</span><h3>{dateLabel(selected)}</h3><p className="reading-regime">{forecastLoading ? "LOADING" : forecastError ? "UNAVAILABLE" : currentRegime}</p>
            <div className="reading-values"><Reading label="RAW GFS · MEAN / MAX" value={forecastLoading ? "LOADING" : forecastError ? "UNAVAILABLE" : `${showValue(forecast.gfs, " mm")} / ${showValue(apiForecast?.rawGfs?.max ?? null, " mm")}`} /><Reading label="AI CORRECTED · RF MEAN / MAX" value={forecastLoading ? "LOADING" : forecastError ? "UNAVAILABLE" : `${showValue(aiModelOutput?.correctedRainMm ?? null, " mm")} / ${showValue(apiForecast?.aiCorrected?.max ?? null, " mm")}`} /><Reading label="IMD OBSERVED · MEAN / MAX" value={forecastLoading ? "LOADING" : forecastError ? "UNAVAILABLE" : `${showValue(forecast.imd, " mm")} / ${showValue(forecast.max, " mm")}`} /><Reading label="GRID EXTENT · ≥ 64.5 MM/DAY" value={showDashboardValue(heavyRainGridFractionPercent, "%")} /><Reading label="DAILY VERIFICATION" value={forecastLoading ? "LOADING" : forecastError ? "UNAVAILABLE" : "Selected-date scores below"} /></div>
            <p className="reading-footnote">{forecastLoading ? "Loading forecast…" : forecastError ? "Forecast unavailable for this date." : `${apiForecast?.modelSource ?? "Source values and model output"} for ${dateLabel(selected)}. Grid extent is a threshold-based spatial share; classifier probability is reported separately when provided by the backend. ${apiForecast?.regimeSource ?? "Regime source pending."}`}</p>
          </aside>
        </div>
        <div className="season-memory-heading"><p className="kicker memory-kicker"><span>11</span> Classifier pathways <i /></p><p>Daily detections and held-out counts come from the rule-based classifier and 2024 evaluation artifact.</p></div>
        <div className="memory-cards">
          <MemoryCard date="REGIME PATH 01" title="Active monsoon" image={monsoonImage} active season="ACTIVE MONSOON" note="Rule-based class using rainfall and atmospheric inputs." amount="PROTOTYPE RULE" />
          <MemoryCard date="REGIME PATH 02" title="Break monsoon" image={winterImage} season="BREAK MONSOON" note="Rule-based break-phase class using frozen 2023 thresholds." amount="PROTOTYPE RULE" />
          <MemoryCard date="REGIME PATH 03" title="Monsoon low" image={autumnImage} season="MONSOON LOW / DEPRESSION" note="Rule-based class for organized low-pressure rainfall regimes." amount="PROTOTYPE RULE" />
          <MemoryCard date="REGIME PATH 04" title="Coastal & orographic" image={summerImage} season="COASTAL / OROGRAPHIC" note="Separate coastal and orographic classes in the classifier." amount="PROTOTYPE RULE" />
        </div>
        <p className="memory-data-note">Atmospheric diagrams are schematic illustrations, not observed or forecast fields.</p>
      </section>

      <section className="finale section-shell">
        <img src={clearImage} alt="Illustrative schematic of atmospheric flow and circulation" width={1024} height={768} loading="lazy" />
        <div className="finale-wash" />
        <div className="finale-copy"><p className="kicker"><span>12</span> A field note</p><h2>WEATHER<br />LEAVES<br /><i>CLUES.</i></h2><p>RainSight brings forecast, atmosphere, rainfall and observation into one visual story.</p><button className="text-link" onClick={() => go("overview")}>Explore again <ArrowRight size={17} /></button></div>
      </section>

      <footer><div><b>RAINSIGHT</b><span>WEATHER INTELLIGENCE</span></div><nav>{nav.map(([label, id]) => <button key={id} onClick={() => go(id)}>{label}</button>)}</nav><p>WEATHER IS A SIGNAL.<br />RAINSIGHT HELPS YOU FOLLOW IT.</p></footer>
    </main>
  );
}

function Header({ active, theme, themeOpen, mobileOpen, date, setTheme, setThemeOpen, setMobileOpen, go }: { active: string; theme: Theme; themeOpen: boolean; mobileOpen: boolean; date: Date; setTheme: (value: Theme) => void; setThemeOpen: (value: boolean) => void; setMobileOpen: (value: boolean) => void; go: (id: string) => void }) {
  return <header className="site-header"><button className="brand" onClick={() => go("overview")}><b>RAINSIGHT</b><small>WEATHER INTELLIGENCE</small></button><nav className={mobileOpen ? "nav-open" : ""}>{nav.map(([label, id]) => <button key={id} className={active === id ? "active" : ""} onClick={() => go(id)}>{label}</button>)}</nav><div className="header-tools"><span className="header-date">{dateLabel(date)}</span><div className="theme-wrap"><button className="weather-button" onClick={() => setThemeOpen(!themeOpen)}><CloudRain size={15} /> WEATHER <ChevronDown size={13} /></button>{themeOpen && <div className="theme-menu">{themes.map((item) => <button key={item.id} className={theme === item.id ? "selected" : ""} onClick={() => { setTheme(item.id); setThemeOpen(false); }}><span className={`theme-dot ${item.id}`} /><b>{item.name}</b><small>{item.note}</small></button>)}</div>}</div><button className="menu-button" aria-label="Toggle navigation" onClick={() => setMobileOpen(!mobileOpen)}>{mobileOpen ? <X /> : <Menu />}</button></div></header>;
}

function Reading({ label, value }: { label: string; value: string }) { return <div className="reading-row"><span>{label}</span><b>{value}</b></div>; }

function SectionTitle({ number, eyebrow, lines, light = false }: { number: string; eyebrow: string; lines: string[]; light?: boolean }) {
  return <div className={`section-title ${light ? "title-light" : ""}`}><p className="kicker"><span>{number}</span>{eyebrow}</p><h2>{lines.map((line, i) => <span key={line} className={i === lines.length - 1 ? "outline-line" : ""}>{line}</span>)}</h2></div>;
}

function StoryCard({ className, number, label, title, value, note, icon, image }: { className: string; number: string; label: string; title: string; value: string; note: string; icon: React.ReactNode; image?: string }) {
  return <article className={`story-card paper-card ${className}`}><span className="card-tab">{label}</span><span className="number-pin">{number}</span>{image ? <img src={image} alt="" width={600} height={400} loading="lazy" /> : <div className="weather-glyph">{icon}<span className="weather-lines" /></div>}<div className="story-body"><small>{label}</small><h3>{title}</h3><div className="story-reading"><b>{value}</b><span>{note}</span></div></div></article>;
}

function WeatherPlate({ number, title, subtitle, value, unit, status, mode, field, gridValues, hasData = true }: { number: string; title: string; subtitle: string; value: string; unit: string; status: string; mode: string; field: Exclude<RainGridField, "error">; gridValues?: RainGridPoint[] | undefined; hasData?: boolean }) {
  const pending = mode === "pending" || !hasData || !gridValues?.length;
  return <article className={`weather-plate ${mode}`}><span className="plate-number">{number}</span><div className={`field-visual ${pending ? "pending" : mode}`}>{pending ? <><span className="pending-cross" /><p>{mode === "pending" ? <>RANDOM FOREST<br />CORRECTION<br /></> : <>GRID<br />FIELD<br /></>}<b>{value === "UNAVAILABLE" ? "UNAVAILABLE" : "PENDING"}</b></p></> : <MaharashtraRainfallField id={number} title={title} values={gridValues ?? []} field={field} />}</div><div className="plate-copy"><small>{subtitle}</small><h3>{title}</h3><strong>{value}</strong><span>{unit}</span><em>{status}</em></div></article>;
}

function MaharashtraRainfallField({ id, title, values, field }: { id: string; title: string; values: RainGridPoint[]; field: Exclude<RainGridField, "error"> }) {
  const clipId = `forecast-field-clip-${id}`;
  return <svg className="weather-field-map" viewBox="0 0 640 470" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${title} rainfall on the Maharashtra 0.25 degree grid`}>
    <defs><clipPath id={clipId}>{maharashtraDistrictPaths.map((district) => <path key={district.name} d={district.d} />)}</clipPath></defs>
    <rect className="weather-field-background" x="0" y="0" width="640" height="470" />
    <g className="weather-field-land">{maharashtraDistrictPaths.map((district) => <path key={district.name} d={district.d} />)}</g>
    <g clipPath={`url(#${clipId})`} className="weather-field-cells">{values.map((point) => {
      const rainfall = point[field];
      const { x, y } = mapCoordinates(point.latitude, point.longitude);
      return <rect key={`${point.latitude}-${point.longitude}`} x={x - 6.84} y={y - 7.25} width="13.68" height="14.5" fill={rainfallCellColor(rainfall)}><title>{`${point.latitude.toFixed(2)}°N, ${point.longitude.toFixed(2)}°E · ${rainfall.toFixed(2)} mm/day`}</title></rect>;
    })}</g>
    <g className="weather-field-districts" aria-hidden="true">{maharashtraDistrictPaths.map((district) => <path key={district.name} d={district.d} />)}</g>
  </svg>;
}

function RainfallLegend() {
  return <div className="rainfall-legend" aria-label="Rainfall intensity in millimetres per day">
    <span className="rainfall-legend-title">RAINFALL · MM/DAY</span>
    {rainfallClasses.map((item, index) => <span className={`rainfall-legend-item${index === rainfallClasses.length - 1 ? " heavy-threshold" : ""}`} key={item.label}>
      <i style={{ backgroundColor: item.color }} /><b>{item.label}</b>{index === rainfallClasses.length - 1 && <small>64.5 mm/day threshold</small>}
    </span>)}
  </div>;
}

function HeavyRainExtent({ probabilityPercent, fractionPercent, threshold, model, evaluationStatus }: { probabilityPercent: number | null; fractionPercent: number | null; threshold: number; model: string | null; evaluationStatus: string | null }) {
  const usableProbability = probabilityPercent !== null && Number.isFinite(probabilityPercent) && probabilityPercent >= 0 && probabilityPercent <= 100;
  return <div className="probability-card paper-card">
    <div><p className="kicker"><span>!</span> Heavy rainfall classifier</p><h3>HEAVY RAINFALL<br />PROBABILITY.</h3>
      <p>{usableProbability ? `ML-estimated probability of rainfall ≥ ${threshold} mm/day.` : "Classifier probabilities are pending from the backend model."} {model ? `Model: ${model}.` : "A trained classifier output is required; rainfall extent is not used as a probability."} Risk bands: LOW &lt;10%, MODERATE 10–&lt;30%, HIGH ≥30%. {evaluationStatus === "TRAINING_PERIOD_OUTPUT" ? "2023 training-period output; not an independent test prediction." : evaluationStatus === "HELD_OUT_2024_PREDICTION" ? "Predicted for the held-out 2024 test period." : ""}</p>
    </div>
    <div className="probability-reading"><span>MEAN GRID-CELL RISK</span><b>{usableProbability ? heavyRainRiskLevel(probabilityPercent) : "PENDING"}</b><small>{usableProbability ? `${probabilityPercent.toFixed(2)}% MEAN PROBABILITY · ${heavyRainRiskLevel(probabilityPercent)} RISK` : "NO CLASSIFIER PROBABILITY RECEIVED"}</small></div>
    <div className="probability-reading"><span>GRID EXTENT</span><b>{fractionPercent === null ? "PENDING" : `${fractionPercent.toFixed(2)}%`}</b><small>SHARE OF CELLS WITH CORRECTED RAINFALL ≥ {threshold} MM/DAY</small></div>
    <div className="probability-threshold"><span>HEAVY RAINFALL THRESHOLD</span><b>≥ {threshold} mm/day</b></div>
  </div>;
}

function RainGrid({ variant = "raw", values, field }: { variant?: string; values: RainGridPoint[]; field: RainGridField }) {
  const maximum = Math.max(1, ...values.map((point) => Math.abs(field === "error" ? point.aiCorrected - point.imd : point[field])));
  return <div className={`rain-grid real-grid ${variant}`} aria-label={`${field === "error" ? "Signed AI corrected minus IMD error" : field} rainfall grid`}>
    {values.map((point) => {
      const value = field === "error" ? point.aiCorrected - point.imd : point[field];
      const width = 100 / 37;
      const height = 100 / 29;
      return <i key={`${point.latitude}-${point.longitude}`} title={`${point.latitude.toFixed(2)}°N, ${point.longitude.toFixed(2)}°E · ${value.toFixed(2)} mm`} style={{ left: `${((point.longitude - 72) / 9) * 100 - width / 2}%`, top: `${((22.5 - point.latitude) / 7) * 100 - height / 2}%`, width: `${width}%`, height: `${height}%`, opacity: 0.22 + (Math.abs(value) / maximum) * 0.72, backgroundColor: field === "error" ? (value === 0 ? "var(--muted-foreground)" : value > 0 ? "var(--coral)" : "var(--rain)") : undefined }} />;
    })}
  </div>;
}

function Instrument({ label, value, position, marks }: { label: string; value: string; position: number; marks: string }) {
  return <div className="instrument-row"><div className="instrument-label"><b>{label}</b><span>{marks}</span></div><div className="instrument-scale"><div className="ticks" />{value !== "PENDING" && <><i style={{ left: `${position}%` }} /><span style={{ left: `${position}%` }}>{value}</span></>}</div></div>;
}

type StationBase = { name: string; x: number; y: number; lat: string; lon: string; area: string; tone: string };
type Station = StationBase & { rain: number | null; gridLatitude: number | null; gridLongitude: number | null };
const stationBases: StationBase[] = [
  { name: "Mumbai", x: 69, y: 211, lat: "19.08", lon: "72.88", area: "west coast", tone: "sun" },
  { name: "Thane", x: 77, y: 198, lat: "19.22", lon: "72.98", area: "Konkan", tone: "coral" },
  { name: "Nashik", x: 126, y: 159, lat: "19.99", lon: "73.79", area: "northwest", tone: "rain" },
  { name: "Pune", x: 133, y: 250, lat: "18.52", lon: "73.85", area: "western ghats", tone: "rain" },
  { name: "Kolhapur", x: 161, y: 355, lat: "16.70", lon: "74.24", area: "south ghat", tone: "sun" },
  { name: "Solapur", x: 270, y: 303, lat: "17.66", lon: "75.91", area: "interior", tone: "mist" },
  { name: "Chh. Sambhajinagar", x: 229, y: 164, lat: "19.88", lon: "75.34", area: "Marathwada", tone: "mist" },
  { name: "Nanded", x: 362, y: 207, lat: "19.14", lon: "77.32", area: "southeast", tone: "mist" },
  { name: "Amravati", x: 388, y: 102, lat: "20.93", lon: "77.75", area: "Vidarbha", tone: "rain" },
  { name: "Nagpur", x: 476, y: 85, lat: "21.15", lon: "79.09", area: "east", tone: "mist" },
];
function mapCoordinates(latitude: number, longitude: number) {
  return { x: 320 + (longitude - 76.8) * 54.7, y: 235 + (19 - latitude) * 58 };
}
const rainfallClasses = [
  { label: "0–0.5", color: "#ece9dd" },
  { label: "0.5–2.5", color: "#b8dfe0" },
  { label: "2.5–10", color: "#79c5ce" },
  { label: "10–25", color: "#3f99bd" },
  { label: "25–64.5", color: "#2469a3" },
  { label: "64.5+", color: "#383786" },
];
function rainfallCellColor(value: number) {
  return rainfallClasses[value < 0.5 ? 0 : value < 2.5 ? 1 : value < 10 ? 2 : value < 25 ? 3 : value < 64.5 ? 4 : 5]!.color;
}
function probabilityCellColor(percent: number) {
  return percent < 10 ? "#d5e9df" : percent < 30 ? "#63b3aa" : "#244e70";
}
function heavyRainRiskLevel(percent: number) {
  return percent >= 30 ? "HIGH" : percent >= 10 ? "MODERATE" : "LOW";
}
function formatRainfall(value: number): string {
  return value === 0 ? "0.00" : Math.abs(value) < 0.01 ? value.toPrecision(3) : value.toFixed(2);
}
function errorCellColor(value: number) {
  if (value <= -25) return "#2469a3";
  if (value <= -2.5) return "#79c5ce";
  if (value < 2.5) return "#ece9dd";
  if (value < 25) return "#edaa89";
  return "#cf654c";
}
function MaharashtraMap({ dateId, forecast, loading, unavailable }: { dateId: string; forecast: ApiForecast | null; loading: boolean; unavailable: boolean }) {
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; lastX: number; lastY: number; moved: boolean } | null>(null);
  const suppressCellClickRef = useRef(false);
  const [isPanning, setIsPanning] = useState(false);
  const date = { label: dateLabel(new Date(`${dateId}T12:00:00`)) };
  const activeRegime = unavailable ? "UNAVAILABLE" : loading || !hasUsableRainGrid(forecast, dateId) ? "PENDING" : regimeLabel(forecast.regime);
  const [selectedName, setSelectedName] = useState("Kolhapur");
  const [selectedGridCell, setSelectedGridCell] = useState<{ dateId: string; point: RainGridPoint } | null>(null);
  const [hoveredGridCell, setHoveredGridCell] = useState<{ dateId: string; point: RainGridPoint } | null>(null);
  const [mapView, setMapView] = useState<"district" | "grid">("grid");
  const [mapLayer, setMapLayer] = useState<"GFS" | "AI CORRECTED" | "IMD" | "ERROR" | "HEAVY RAIN PROBABILITY">("HEAVY RAIN PROBABILITY");
  useEffect(() => { setSelectedGridCell(null); setHoveredGridCell(null); if (selectedName === "Grid cell") setSelectedName("Kolhapur"); }, [dateId]);
  const currentForecast = !loading && !unavailable && hasUsableRainGrid(forecast, dateId) ? forecast : null;
  const currentGrid = currentForecast?.rainfallGrid ?? [];
  const selectedPointForDate = currentForecast && selectedGridCell?.dateId === dateId ? selectedGridCell.point : null;
  const hoveredPointForDate = currentForecast && hoveredGridCell?.dateId === dateId ? hoveredGridCell.point : null;
  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const rect = mapElementRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pointX = (clientX - rect.left) * 640 / rect.width;
    const pointY = (clientY - rect.top) * 470 / rect.height;
    setView((current) => {
      const zoom = Math.max(1, Math.min(4, current.zoom * factor));
      const ratio = zoom / current.zoom;
      return { zoom, panX: pointX - (pointX - current.panX) * ratio, panY: pointY - (pointY - current.panY) * ratio };
    });
  };
  const handleMapWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if ((event.target instanceof Element && event.target.closest(".atlas-controls"))) return;
    event.preventDefault();
    zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * 0.0012));
  };
  const handleMapPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0 || (event.target instanceof Element && event.target.closest(".atlas-controls"))) return;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
  };
  const handleMapPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    if (!drag.moved && Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > 3) {
      drag.moved = true;
      setIsPanning(true);
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
    }
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (drag.moved) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      setView((current) => ({ ...current, panX: current.panX + dx * 640 / rect.width, panY: current.panY + dy * 470 / rect.height }));
    }
  };
  const finishMapPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved) {
      suppressCellClickRef.current = true;
      window.setTimeout(() => { suppressCellClickRef.current = false; }, 0);
    }
    dragRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const zoomMapBy = (factor: number) => {
    const rect = mapElementRef.current?.getBoundingClientRect();
    if (rect) zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  };
  const stations: Station[] = stationBases.map((base) => {
    const nearest = currentGrid.reduce((best, point) => {
      const distance = (point.latitude - Number(base.lat)) ** 2 + (point.longitude - Number(base.lon)) ** 2;
      return distance < best.distance ? { distance, point } : best;
    }, { distance: Number.POSITIVE_INFINITY, point: null as (NonNullable<ApiForecast["rainfallGrid"]>[number] | null) })?.point ?? null;
    const rain = nearest === null ? null : mapLayer === "GFS" ? nearest.gfs : mapLayer === "AI CORRECTED" ? nearest.aiCorrected : mapLayer === "IMD" ? nearest.imd : mapLayer === "ERROR" ? nearest.aiCorrected - nearest.imd : nearest.heavyRainProbability == null ? null : nearest.heavyRainProbability * 100;
    return { ...base, rain, gridLatitude: nearest?.latitude ?? null, gridLongitude: nearest?.longitude ?? null };
  });
  const selectedCellValue = selectedPointForDate === null ? null : mapLayer === "GFS" ? selectedPointForDate.gfs : mapLayer === "AI CORRECTED" ? selectedPointForDate.aiCorrected : mapLayer === "IMD" ? selectedPointForDate.imd : mapLayer === "ERROR" ? selectedPointForDate.aiCorrected - selectedPointForDate.imd : selectedPointForDate.heavyRainProbability == null ? null : selectedPointForDate.heavyRainProbability * 100;
  const selected = selectedPointForDate ? { ...stationBases[0]!, name: "Grid cell", area: "0.25° rainfall grid", rain: selectedCellValue, gridLatitude: selectedPointForDate.latitude, gridLongitude: selectedPointForDate.longitude } : stations.find((s) => s.name === selectedName) ?? stations[0]!;
  const selectedPoint = currentForecast ? selectedPointForDate ?? currentGrid.find((point) => point.latitude === selected.gridLatitude && point.longitude === selected.gridLongitude) ?? null : null;
  const stationsWithData = stations.filter((station): station is Station & { rain: number } => station.rain !== null);
  const mean = stationsWithData.length ? stationsWithData.reduce((sum, s) => sum + s.rain, 0) / stationsWithData.length : 0;
  const emptyStation: Station = { ...stationBases[0]!, rain: null, gridLatitude: null, gridLongitude: null };
  const wettest = stationsWithData.reduce<Station>((a, b) => (b.rain > (a.rain ?? -Infinity) ? b : a), stationsWithData[0] ?? emptyStation);
  const driest = stationsWithData.reduce<Station>((a, b) => (b.rain < (a.rain ?? Infinity) ? b : a), stationsWithData[0] ?? emptyStation);
  const hasLayerData = currentGrid.length > 0;
  return <div className="atlas-layout">
    <div className="atlas-sheet">
      <div className="atlas-sheet-head"><span>SHEET 07 — MAHARASHTRA RAINFALL FIELD</span><span>72.4°E – 81.2°E · 15.3°N – 22.3°N</span></div>
      <div className="atlas-data-controls"><div><span>VIEW</span>{(["district", "grid"] as const).map((view) => <button key={view} className={mapView === view ? "selected" : ""} onClick={() => setMapView(view)}>{view === "grid" ? "0.25° GRID" : "DISTRICT BOUNDARIES"}</button>)}</div><div><span>DATA</span>{(["GFS", "AI CORRECTED", "IMD", "ERROR", "HEAVY RAIN PROBABILITY"] as const).map((layer) => <button key={layer} className={mapLayer === layer ? "selected" : ""} onClick={() => setMapLayer(layer)}>{layer}</button>)}</div></div>
      <div className="atlas-date-bar">
        <span className="atlas-date-label">SELECTED SOURCE DATE · {dateLabel(new Date(`${dateId}T12:00:00`))}</span>
        <small className="atlas-map-instruction">HOVER A CELL TO INSPECT · CLICK TO LOCK</small>
      </div>
      <div ref={mapElementRef} className={`atlas-map map-view-${mapView}${isPanning ? " is-panning" : ""}`} onWheel={handleMapWheel} onPointerDown={handleMapPointerDown} onPointerMove={handleMapPointerMove} onPointerUp={finishMapPointer} onPointerCancel={finishMapPointer}><svg viewBox="0 0 640 470" role="img" aria-label={`Maharashtra rainfall map, ${mapView === "grid" ? "quarter degree grid" : "state and district boundaries"}, ${mapLayer} layer`}>
        <defs><clipPath id="atlas-state-clip" clipPathUnits="userSpaceOnUse">{maharashtraDistrictPaths.map((district) => <path key={district.name} d={district.d} />)}</clipPath></defs>
        <g className="atlas-zoom" transform={`translate(${view.panX} ${view.panY}) scale(${view.zoom})`}>
          <g className="atlas-land">{maharashtraDistrictPaths.map((district) => <path key={district.name} d={district.d} />)}</g>
          <g clipPath="url(#atlas-state-clip)" className="atlas-rain-cells">
            {currentGrid.map((point) => {
              const value = mapLayer === "GFS" ? point.gfs : mapLayer === "AI CORRECTED" ? point.aiCorrected : mapLayer === "IMD" ? point.imd : mapLayer === "ERROR" ? point.aiCorrected - point.imd : point.heavyRainProbability == null ? null : point.heavyRainProbability * 100;
              const { x, y } = mapCoordinates(point.latitude, point.longitude);
              return <rect key={`${point.latitude}-${point.longitude}`} x={x - 6.84} y={y - 7.25} width="13.68" height="14.5" fill={value === null ? "#b8b2a4" : mapLayer === "ERROR" ? errorCellColor(value) : mapLayer === "HEAVY RAIN PROBABILITY" ? probabilityCellColor(value) : rainfallCellColor(value)} className={`atlas-rain-cell ${selectedPointForDate?.latitude === point.latitude && selectedPointForDate.longitude === point.longitude ? "is-selected" : ""}`} tabIndex={0} role="button" aria-label={`${point.latitude.toFixed(2)} degrees north, ${point.longitude.toFixed(2)} degrees east, ${value === null ? "probability unavailable" : mapLayer === "HEAVY RAIN PROBABILITY" ? `${heavyRainRiskLevel(value)} risk, ${value.toFixed(2)} percent heavy rainfall probability` : `${value.toFixed(2)} millimetres`}. Select grid cell`} onMouseEnter={() => setHoveredGridCell({ dateId, point })} onMouseLeave={() => setHoveredGridCell(null)} onFocus={() => setHoveredGridCell({ dateId, point })} onBlur={() => setHoveredGridCell(null)} onClick={(event) => { if (suppressCellClickRef.current) { event.preventDefault(); event.stopPropagation(); suppressCellClickRef.current = false; return; } setSelectedGridCell({ dateId, point }); setSelectedName("Grid cell"); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedGridCell({ dateId, point }); setSelectedName("Grid cell"); } }}><title>{`${point.latitude.toFixed(2)}°N, ${point.longitude.toFixed(2)}°E · ${value === null ? "probability pending" : mapLayer === "HEAVY RAIN PROBABILITY" ? `${heavyRainRiskLevel(value)} risk · ${value.toFixed(2)}% probability` : `${value.toFixed(2)} mm`}`}</title></rect>;
            })}
          </g>
          {mapView === "grid" && <g className="atlas-grid atlas-land-grid" clipPath="url(#atlas-state-clip)">{Array.from({ length: 10 }, (_, i) => <line key={`v${i}`} x1={45+i*61} x2={45+i*61} y1="20" y2="440" />)}{Array.from({ length: 8 }, (_, i) => <line key={`h${i}`} x1="25" x2="615" y1={38+i*55} y2={38+i*55} />)}</g>}
          <g className="atlas-district-boundaries" pointerEvents="none">{maharashtraDistrictPaths.map((district) => <path key={district.name} d={district.d} />)}</g>
          {hasLayerData && stations.filter((station) => station.rain !== null).map(station => <g key={station.name} className={`atlas-station ${selected.name === station.name ? "is-selected" : ""}`} role="button" tabIndex={0} aria-label={`${station.name}, ${station.rain === null ? "no data" : formatRainfall(station.rain)} millimetre nearest grid cell. Select station`} onClick={() => { setSelectedGridCell(null); setSelectedName(station.name); }} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedGridCell(null); setSelectedName(station.name); } }}>
            <circle className="atlas-dot atlas-dot-rain" cx={mapCoordinates(Number(station.lat), Number(station.lon)).x} cy={mapCoordinates(Number(station.lat), Number(station.lon)).y} r={Math.max(2.5, Math.min(5.5, 2.5 + (station.rain ?? 0) * .035))} />
            <text x={mapCoordinates(Number(station.lat), Number(station.lon)).x + 6} y={mapCoordinates(Number(station.lat), Number(station.lon)).y + 3}>{station.name.toUpperCase()}</text>
          </g>)}
        </g><text className="atlas-sea" x="28" y="446">ARABIAN SEA</text>
      </svg>{hoveredPointForDate && currentForecast && <div className="atlas-cell-readout" aria-live="polite"><b>{hoveredPointForDate.latitude.toFixed(2)}°N · {hoveredPointForDate.longitude.toFixed(2)}°E</b><span>{mapLayer === "HEAVY RAIN PROBABILITY" ? hoveredPointForDate.heavyRainProbability == null ? "Probability pending" : `${heavyRainRiskLevel(hoveredPointForDate.heavyRainProbability * 100)} risk · ${(hoveredPointForDate.heavyRainProbability * 100).toFixed(2)}% ML probability` : `${(mapLayer === "GFS" ? hoveredPointForDate.gfs : mapLayer === "AI CORRECTED" ? hoveredPointForDate.aiCorrected : mapLayer === "IMD" ? hoveredPointForDate.imd : hoveredPointForDate.aiCorrected - hoveredPointForDate.imd).toFixed(2)} mm · ${mapLayer}`}</span></div>}{!hasLayerData && <div className="map-pending">{mapLayer}<b>{loading ? "LOADING FORECAST…" : unavailable || (forecast && !currentForecast) ? "FORECAST UNAVAILABLE FOR THIS DATE" : mapLayer === "AI CORRECTED" ? "NO MODEL OUTPUT" : "PENDING · NOT CONNECTED"}</b></div>}<div className="atlas-controls"><Button variant="ghost" size="icon" aria-label="Zoom in" title="Zoom in" onClick={() => zoomMapBy(1.2)}><Plus /></Button><Button variant="ghost" size="icon" aria-label="Zoom out" title="Zoom out" onClick={() => zoomMapBy(1 / 1.2)}><Minus /></Button><Button variant="ghost" size="icon" aria-label="Reset map zoom" title="Reset map zoom" onClick={() => setView({ zoom: 1, panX: 0, panY: 0 })}><RotateCcw /></Button></div></div>
      <div className="atlas-sheet-foot"><span>{mapView === "grid" ? "0.25° GRID VIEW" : "MAHARASHTRA · DISTRICT BOUNDARIES"} · {hasLayerData ? mapLayer === "HEAVY RAIN PROBABILITY" ? "PER-CELL ML PROBABILITY · %" : "SOURCE GRID CELLS · MM" : "SOURCE VALUES PENDING"}</span>{mapLayer === "ERROR" ? <span className="atlas-rain-legend error"><i><b>AI &lt; IMD · UNDERPREDICTION</b></i><i><b>NEAR ZERO · CLOSE MATCH</b></i><i><b>AI &gt; IMD · OVERPREDICTION</b></i></span> : mapLayer === "HEAVY RAIN PROBABILITY" ? <span className="atlas-rain-legend"><i style={{ backgroundColor: probabilityCellColor(0) }}><b>LOW · &lt;10%</b></i><i style={{ backgroundColor: probabilityCellColor(10) }}><b>MODERATE · 10–&lt;30%</b></i><i style={{ backgroundColor: probabilityCellColor(30) }}><b>HIGH · ≥30%</b></i><small>ML probability · ≥64.5 mm/day</small></span> : <span className="atlas-rain-legend">{rainfallClasses.map((item) => <i key={item.label} style={{ backgroundColor: item.color }}><b>{item.label}</b></i>)}<small>mm/day</small></span>}<a className="atlas-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></div>
    </div>
    <aside className="atlas-side"><div className="atlas-selected"><span className="atlas-overline">SELECTED GRID CELL · {mapLayer}</span><h3>{selected.name}</h3><p>{selected.area}</p><strong>{selected.rain === null ? "—" : formatRainfall(selected.rain)}</strong><small>{selected.rain === null ? "NO LAYER DATA · PENDING" : mapLayer === "ERROR" ? `SIGNED ERROR · AI − IMD · MM · ${date.label}` : mapLayer === "HEAVY RAIN PROBABILITY" ? `ML-ESTIMATED HEAVY RAIN PROBABILITY · ≥64.5 MM/DAY · ${date.label}` : `GRID-CELL RAINFALL · MM · ${date.label}`}</small><div className="atlas-facts"><div><span>LATITUDE</span><b>{selected.gridLatitude === null ? "PENDING" : `${selected.gridLatitude.toFixed(2)}°N`}</b></div><div><span>LONGITUDE</span><b>{selected.gridLongitude === null ? "PENDING" : `${selected.gridLongitude.toFixed(2)}°E`}</b></div><div><span>REGIME</span><b>{activeRegime}</b></div><div><span>LISTED CELL MEAN</span><b>{hasLayerData ? `${formatRainfall(mean)} ${mapLayer === "HEAVY RAIN PROBABILITY" ? "%" : "mm"}` : "PENDING"}</b></div></div></div>
      <div className="atlas-analysis"><span className="atlas-overline">DAY ANALYSIS · {date.label}</span><div className="atlas-facts"><div><span>REGIME</span><b>{activeRegime}</b></div><div><span>{mapLayer === "HEAVY RAIN PROBABILITY" ? "HIGHEST LISTED PROBABILITY" : "WETTEST LISTED CELL"}</span><b>{hasLayerData ? `${wettest.name} · ${formatRainfall(wettest.rain!)} ${mapLayer === "HEAVY RAIN PROBABILITY" ? "%" : "mm"}` : "PENDING"}</b></div><div><span>{mapLayer === "HEAVY RAIN PROBABILITY" ? "LOWEST LISTED PROBABILITY" : "DRIEST LISTED CELL"}</span><b>{hasLayerData ? `${driest.name} · ${formatRainfall(driest.rain!)} ${mapLayer === "HEAVY RAIN PROBABILITY" ? "%" : "mm"}` : "PENDING"}</b></div><div><span>LISTED CELL SPREAD</span><b>{hasLayerData ? `${formatRainfall(wettest.rain! - driest.rain!)} ${mapLayer === "HEAVY RAIN PROBABILITY" ? "percentage points" : "mm"}` : "PENDING"}</b></div></div></div>
      <details className="cell-explainability" open={Boolean(selectedPointForDate)}><summary>WHAT INFORMED THE CORRECTION?</summary>{selectedPoint ? <><div className="cell-explain-regime"><span>REGIME</span><b>{activeRegime}</b></div><b className="cell-section-label">MODEL INPUTS</b><div className="cell-explain-values"><span>GFS RAINFALL · SELECTED CELL<b>{selectedPoint.gfs.toFixed(2)} mm</b></span><span>CAPE · DATE-WIDE SUMMARY<b>{typeof currentForecast?.atmosphericFeatures?.capeJkg === "number" ? `${currentForecast.atmosphericFeatures.capeJkg.toFixed(2)} J/kg` : "NOT AVAILABLE"}</b></span><span>RH · 2 M · DATE-WIDE SUMMARY<b>{typeof currentForecast?.atmosphericFeatures?.rh2mPercent === "number" ? `${currentForecast.atmosphericFeatures.rh2mPercent.toFixed(2)}%` : "NOT AVAILABLE"}</b></span><span>MSLP · DATE-WIDE SUMMARY<b>{typeof currentForecast?.atmosphericFeatures?.mslpHpa === "number" ? `${currentForecast.atmosphericFeatures.mslpHpa.toFixed(2)} hPa` : "NOT AVAILABLE"}</b></span><span>U WIND · 10 M · DATE-WIDE SUMMARY<b>{typeof currentForecast?.atmosphericFeatures?.uWind10mMs === "number" ? `${currentForecast.atmosphericFeatures.uWind10mMs.toFixed(2)} m/s` : "NOT AVAILABLE"}</b></span><span>V WIND · 10 M · DATE-WIDE SUMMARY<b>{typeof currentForecast?.atmosphericFeatures?.vWind10mMs === "number" ? `${currentForecast.atmosphericFeatures.vWind10mMs.toFixed(2)} m/s` : "NOT AVAILABLE"}</b></span></div><b className="cell-section-label">MODEL OUTPUTS · SELECTED CELL</b><div className="cell-explain-values"><span>RAW GFS<b>{selectedPoint.gfs.toFixed(2)} mm</b></span><span>AI CORRECTED<b>{selectedPoint.aiCorrected.toFixed(2)} mm</b></span><span>RF CHANGE · AI − GFS<b>{(selectedPoint.aiCorrected - selectedPoint.gfs).toFixed(2)} mm</b></span><span>IMD OBSERVED<b>{selectedPoint.imd.toFixed(2)} mm</b></span><span>SIGNED ERROR · AI − IMD<b>{(selectedPoint.aiCorrected - selectedPoint.imd).toFixed(2)} mm</b></span></div><p>Atmospheric values are date-wide grid summaries, not cell measurements. These are model inputs and outputs, not causal attribution scores.</p></> : <p>{loading ? "Loading forecast…" : unavailable ? "Forecast unavailable for this date." : "Select a grid cell to inspect its values."}</p>}</details>
      <div className="atlas-station-list" aria-label="Nearest rainfall grid cells"><span className="atlas-overline">NEAREST GRID CELLS · {mapLayer === "HEAVY RAIN PROBABILITY" ? "% PROBABILITY" : "MM"}</span>{stations.map(station => <Button key={station.name} variant="ghost" className={`atlas-list-row ${selected.name === station.name ? "is-selected" : ""}`} onClick={() => setSelectedName(station.name)} aria-pressed={selected.name === station.name}><span>{station.name.toUpperCase()}</span><i className="atlas-bar atlas-bar-rain" style={{ width: station.rain === null ? "12px" : `${Math.max(12, Math.abs(station.rain) * 1.5)}px` }} /><b>{station.rain === null ? "PENDING" : `${formatRainfall(station.rain)} ${mapLayer === "HEAVY RAIN PROBABILITY" ? "%" : "mm"}`}</b></Button>)}</div>
      <div className="atlas-note"><b>OROGRAPHIC EFFECT</b><small>Relief can enhance rainfall on windward slopes.</small></div>
    </aside>
  </div>;
}

function MiniMap({ title, supportingText, pattern, value, field, gridValues }: { title: string; supportingText: string; pattern: string; value: string; field: RainGridField; gridValues?: RainGridPoint[] | undefined }) { const unavailable = value === "PENDING" || value === "LOADING" || value === "UNAVAILABLE" || !gridValues?.length; const pendingText = value === "LOADING" ? "LOADING FORECAST…" : value === "UNAVAILABLE" ? "FORECAST UNAVAILABLE" : "GRID DATA PENDING"; return <div className="mini-map"><div className="mini-map-head"><div><b>{title}</b><small>{supportingText}</small></div><span>{value}</span></div><div className={`mini-field ${pattern} ${unavailable ? "unavailable" : ""}`}>{!unavailable && <RainGrid variant={pattern} values={gridValues ?? []} field={field} />}<svg viewBox="0 0 300 180" aria-hidden="true"><path d="M28 63 L55 45 L95 41 L121 27 L151 44 L190 41 L213 54 L248 52 L278 73 L265 102 L239 109 L222 135 L185 138 L160 154 L124 140 L91 146 L67 123 L40 112 L43 85 Z" /></svg>{unavailable && <span className="mini-pending">{pendingText}</span>}</div>{!unavailable && field === "error" && <div className="error-legend"><span><i className="error-positive" /><b><strong>AI &gt; IMD</strong><small>OVERPREDICTION</small></b></span><span><i className="error-neutral" /><b><strong>NEAR MATCH</strong></b></span><span><i className="error-negative" /><b><strong>AI &lt; IMD</strong><small>UNDERPREDICTION</small></b></span></div>}</div> }
function MemoryCard({ date, title, image, season, note, amount, active = false }: { date: string; title: string; image: string; season: string; note: string; amount: string; active?: boolean }) { return <article className={`memory-card paper-card ${active ? "active" : ""}`}><div className="memory-image"><img src={image} alt={`Schematic ${season.toLowerCase()} atmospheric illustration`} width={600} height={300} loading="lazy" /></div><span>{date}</span><h3>{title}</h3><p>{note}</p><b className="memory-amount">{amount} <ArrowRight size={13} /></b></article> }
