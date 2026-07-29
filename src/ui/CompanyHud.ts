import { EventBus } from '../services/EventBus';
import type { OperatingSummaryDto } from '../freight/FreightPresentation';

const CASH = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

const formatSignedCash = (value: number): string => value < 0
  ? `−${CASH.format(Math.abs(value))}`
  : CASH.format(value);

const ECONOMY_TICKS_PER_DAY = 24;

export interface CompanyHudState {
  cash: number;
  saveState: 'saved' | 'unsaved' | 'saving';
  economyTick: number;
  constructionIndexBps: number;
  operatingSummary: OperatingSummaryDto;
}

/** Compact authoritative company state shared by Build and Operate modes. */
export class CompanyHud {
  private readonly root = document.createElement('section');
  private readonly cash = document.createElement('strong');
  private readonly saveState = document.createElement('span');
  private readonly economyTime = document.createElement('span');
  private readonly constructionIndex = document.createElement('span');
  private readonly operatingPeriod = document.createElement('span');
  private readonly deliveryRevenue = document.createElement('span');
  private readonly contractBonuses = document.createElement('span');
  private readonly runningExpenses = document.createElement('span');
  private readonly operatingProfit = document.createElement('strong');
  private readonly capitalExpenditure = document.createElement('span');
  private readonly cashFlow = document.createElement('span');
  private readonly cashPulse = document.createElement('strong');
  private visible = true;
  private readonly resizeHandler = () => this.applyLayout();

  private readonly stateHandler = (state: CompanyHudState) => (
    this.setState(state)
  );
  private readonly cashPulseHandler = ({ amount }: { amount: number }) => {
    this.cashPulse.textContent = `+${CASH.format(amount)}`;
    this.cashPulse.style.display = amount > 0 ? 'inline' : 'none';
  };

  constructor() {
    this.root.dataset.testid = 'company-hud';
    this.root.setAttribute('aria-label', 'Company finances');
    this.root.setAttribute('aria-live', 'polite');
    this.root.style.cssText = [
      'position:fixed',
      'box-sizing:border-box',
      'z-index:1190',
      'left:86px',
      'top:12px',
      'display:flex',
      'align-items:center',
      'gap:8px',
      'flex-wrap:wrap',
      'padding:7px 10px',
      'border:1px solid rgba(102,202,255,.3)',
      'border-radius:6px',
      'background:rgba(6,19,31,.92)',
      'color:#d8efff',
      'font:12px Verdana,sans-serif',
      'pointer-events:none',
    ].join(';');
    this.cash.dataset.testid = 'company-cash';
    this.cash.style.cssText = 'font-size:15px;color:#fff';
    this.saveState.dataset.testid = 'company-save-state';
    this.saveState.style.cssText = 'color:#8ab4d0';
    this.economyTime.dataset.testid = 'company-economy-time';
    this.economyTime.style.cssText = 'color:#bad3e2';
    this.constructionIndex.dataset.testid = 'company-construction-index';
    this.constructionIndex.style.cssText = 'color:#9feaff';
    this.operatingPeriod.dataset.testid = 'company-operating-period';
    this.deliveryRevenue.dataset.testid = 'company-delivery-revenue';
    this.contractBonuses.dataset.testid = 'company-contract-bonuses';
    this.runningExpenses.dataset.testid = 'company-running-expenses';
    this.operatingProfit.dataset.testid = 'company-operating-profit';
    this.operatingProfit.style.cssText = 'color:#9af0b6';
    this.capitalExpenditure.dataset.testid = 'company-capital-expenditure';
    this.cashFlow.dataset.testid = 'company-cash-flow';
    this.cashPulse.dataset.testid = 'company-cash-pulse';
    this.cashPulse.style.cssText = 'display:none;color:#9af0b6';
    this.root.append(
      this.cash,
      this.saveState,
      this.economyTime,
      this.constructionIndex,
      this.operatingPeriod,
      this.deliveryRevenue,
      this.contractBonuses,
      this.runningExpenses,
      this.operatingProfit,
      this.capitalExpenditure,
      this.cashFlow,
      this.cashPulse,
    );
    document.body.append(this.root);
    this.applyLayout();
    this.setVisible(true);
    EventBus.on('ui:company-state', this.stateHandler);
    EventBus.on('ui:cash-pulse', this.cashPulseHandler);
    window.addEventListener('resize', this.resizeHandler);
  }

  setState(state: CompanyHudState): void {
    this.cash.textContent = CASH.format(state.cash);
    this.saveState.textContent = state.saveState === 'saved'
      ? 'Saved'
      : state.saveState === 'saving'
        ? 'Saving…'
        : 'Unsaved';
    this.root.dataset.saveState = state.saveState;
    const day = Math.floor(state.economyTick / ECONOMY_TICKS_PER_DAY) + 1;
    this.economyTime.textContent = `Day ${day.toLocaleString('en-GB')} · Tick ${state.economyTick.toLocaleString('en-GB')}`;
    this.constructionIndex.textContent = `Construction index ${(state.constructionIndexBps / 100).toFixed(1)}`;
    this.operatingPeriod.textContent = 'Last 24 ticks';
    this.deliveryRevenue.textContent =
      `Deliveries ${CASH.format(state.operatingSummary.deliveryRevenue)}`;
    this.contractBonuses.textContent =
      `Development ${CASH.format(state.operatingSummary.contractBonuses)}`;
    this.runningExpenses.textContent =
      `Running ${CASH.format(state.operatingSummary.runningExpenses)}`;
    this.operatingProfit.textContent =
      `Rail profit ${formatSignedCash(state.operatingSummary.operatingProfit)}`;
    this.capitalExpenditure.textContent =
      `Capex ${CASH.format(state.operatingSummary.capitalExpenditure)}`;
    this.cashFlow.textContent =
      `Cash flow ${formatSignedCash(state.operatingSummary.cashFlow)}`;
  }

  private applyLayout(): void {
    const mobile = window.innerWidth <= 720;
    this.root.dataset.layout = mobile ? 'mobile' : 'desktop';
    if (mobile) {
      this.root.style.left = '56px';
      this.root.style.right = '96px';
      this.root.style.width = 'auto';
    } else {
      this.root.style.left = '86px';
      this.root.style.right = 'auto';
      this.root.style.width = 'auto';
    }
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.root.style.display = visible ? 'flex' : 'none';
    this.root.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  containsScreenPoint(x: number, y: number): boolean {
    if (!this.visible) return false;
    const bounds = this.root.getBoundingClientRect();
    return x >= bounds.left && x <= bounds.right
      && y >= bounds.top && y <= bounds.bottom;
  }

  destroy(): void {
    EventBus.off('ui:company-state', this.stateHandler);
    EventBus.off('ui:cash-pulse', this.cashPulseHandler);
    window.removeEventListener('resize', this.resizeHandler);
    this.root.remove();
  }
}
