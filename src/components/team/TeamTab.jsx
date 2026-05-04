import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  getTeamStats,
  getTeamActivity,
  getAllSales,
  updateSaleDetails,
} from '../../lib/teamService';
import { sqlocal } from '../../lib/db';
import './teamStyles.css';
import '../mapStyles.css';

const STATUS_COLORS = {
  NO_ANSWER:      '#6b7280',
  CONVO:          '#3b82f6',
  SALE:           '#10b981',
  NOT_INTERESTED: '#ef4444',
  CALLBACK:       '#a855f7',
  THINKING:       '#60a5fa',
  NO_SOLICITING:  '#dc2626',
  CONSTRUCTION:   '#f59e0b',
};

const AVATAR_COLORS = [
  'linear-gradient(135deg,#6366f1,#8b5cf6)',
  'linear-gradient(135deg,#10b981,#059669)',
  'linear-gradient(135deg,#f59e0b,#d97706)',
  'linear-gradient(135deg,#ef4444,#dc2626)',
  'linear-gradient(135deg,#3b82f6,#2563eb)',
  'linear-gradient(135deg,#ec4899,#db2777)',
];

// ── Close-Rate Ring Component ──
function CloseRing({ pct, size = 44 }) {
  const radius = (size - 6) / 2;
  const circ = 2 * Math.PI * radius;
  const stroke = (parseFloat(pct) / 100) * circ;
  const color = parseFloat(pct) >= 10 ? '#10b981' : parseFloat(pct) >= 5 ? '#f59e0b' : '#6b7280';

  return (
    <div className="lb-close-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={3} />
        <circle
          cx={size/2} cy={size/2} r={radius} fill="none"
          stroke={color} strokeWidth={3}
          strokeDasharray={`${stroke} ${circ}`}
          strokeLinecap="round"
        />
      </svg>
      <div className="lb-close-pct">{pct}%</div>
    </div>
  );
}

// ── Custom Calendar Date Picker ──
function CustomDatePicker({ onSelect, onClose, currentDate }) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dayNames = ['Su','Mo','Tu','We','Th','Fr','Sa'];

  function getDaysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }
  function getFirstDayOfMonth(year, month) {
    return new Date(year, month, 1).getDay();
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    const now = new Date();
    if (viewYear > now.getFullYear() || (viewYear === now.getFullYear() && viewMonth >= now.getMonth())) return;
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfMonth(viewYear, viewMonth);
  const todayISO = today.toISOString().split('T')[0];

  function isFuture(day) {
    const d = new Date(viewYear, viewMonth, day);
    return d > today;
  }

  function isSelected(day) {
    if (!currentDate || currentDate === 'TODAY' || currentDate === 'YESTERDAY' || currentDate === 'ALL_TIME') return false;
    const iso = `${viewYear}-${String(viewMonth + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    return iso === currentDate;
  }

  function isToday(day) {
    const iso = `${viewYear}-${String(viewMonth + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    return iso === todayISO;
  }

  function handleDayClick(day) {
    if (isFuture(day)) return;
    const iso = `${viewYear}-${String(viewMonth + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    onSelect(iso);
    onClose();
  }

  const isAtCurrentMonth = viewYear === today.getFullYear() && viewMonth === today.getMonth();

  return (
    <div className="datepicker-overlay" onClick={onClose}>
      <div className="datepicker-panel" onClick={e => e.stopPropagation()}>
        <div className="datepicker-header">
          <button className="datepicker-nav" onClick={prevMonth}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <span className="datepicker-month-label">{monthNames[viewMonth]} {viewYear}</span>
          <button className="datepicker-nav" onClick={nextMonth} disabled={isAtCurrentMonth} style={{ opacity: isAtCurrentMonth ? 0.2 : 1 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>
        <div className="datepicker-day-names">
          {dayNames.map(d => <span key={d} className="datepicker-day-name">{d}</span>)}
        </div>
        <div className="datepicker-grid">
          {Array.from({ length: firstDay }, (_, i) => (
            <span key={`empty-${i}`} />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1;
            const future = isFuture(day);
            const selected = isSelected(day);
            const todayDay = isToday(day);
            return (
              <button
                key={day}
                className={`datepicker-day ${selected ? 'selected' : ''} ${todayDay ? 'today' : ''} ${future ? 'future' : ''}`}
                onClick={() => handleDayClick(day)}
                disabled={future}
              >
                {day}
              </button>
            );
          })}
        </div>
        <button className="datepicker-cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

export default function TeamTab({ user, repName, isActive }) {
  const [segment, setSegment] = useState('LEADERBOARD'); // 'LEADERBOARD' | 'ACTIVITY' | 'SALES'
  const [stats, setStats] = useState([]);
  const [activityData, setActivityData] = useState({ feed: [], radar: [] });
  const [allSales, setAllSales] = useState([]);
  const [operationsSale, setOperationsSale] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [boardDate, setBoardDate] = useState('TODAY');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [salesSearch, setSalesSearch] = useState('');
  const [editSale, setEditSale] = useState(null);   // sale object being edited
  const [editForm, setEditForm] = useState({});      // controlled form values
  const [saving, setSaving] = useState(false);

  const longPressTimerRef = useRef(null);

  // ── Handlers ──
  function handleCardPressStart(sale) {
    longPressTimerRef.current = setTimeout(() => {
      setOperationsSale(sale);
    }, 500);
  }

  function handleCardPressEnd() {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function openEditModal(sale) {
    setEditSale(sale);
    setEditForm({
      rep_override:    sale.details.rep_override    || sale.rep_name || '',
      homeowner_name:  sale.details.homeowner_name  || '',
      job_total:       sale.details.job_total       || '',
      phone:           sale.details.phone           || '',
      email:           sale.details.email           || '',
      service_date:    sale.details.service_date    || '',
      payment_method:  sale.details.payment_method  || '',
    });
  }

  async function handleSaveEdit() {
    if (!editSale?.event_id) {
      showToast('Cannot edit — no event ID found.', 'error');
      return;
    }
    setSaving(true);
    try {
      await updateSaleDetails(editSale.event_id, editForm);
      // Optimistically update local state
      setAllSales(prev => prev.map(s =>
        s.id === editSale.id
          ? { ...s, rep_name: editForm.rep_override || s.rep_name, details: { ...s.details, ...editForm } }
          : s
      ));
      showToast('Sale updated!', 'success');
      setEditSale(null);
    } catch (err) {
      showToast(err.message || 'Save failed.', 'error');
    } finally {
      setSaving(false);
    }
  }

  // ── Load non-map data ──
  const loadData = useCallback(async (dateOverride) => {
    if (!navigator.onLine) return;
    const dateToUse = dateOverride !== undefined ? dateOverride : boardDate;
    try {
      const [s, a, sales] = await Promise.all([
        getTeamStats(dateToUse),
        getTeamActivity(),
        getAllSales()
      ]);
      setStats(s);
      setActivityData(a);
      setAllSales(sales);
    } catch (err) {
      console.error('[TeamTab] loadData error:', err);
    } finally {
      setLoading(false);
    }
  }, [boardDate]);

  useEffect(() => {
    if (!isActive) return;
    loadData();
    const id = setInterval(loadData, 30000); // refresh every 30s when active
    return () => clearInterval(id);
  }, [isActive, loadData]);

  function showToast(msg, type) {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3100);
  }

  function getInitials(name) {
    return (name || '?').split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase();
  }

  function getTimeAgo(dateStr) {
    if (!dateStr) return '';
    const diffMs = new Date() - new Date(dateStr);
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    return `${diffHrs}h ago`;
  }

  function handleDateChange(value) {
    setBoardDate(value);
    setLoading(true);
    loadData(value);
  }

  function getBoardTitle() {
    if (boardDate === 'TODAY') return "Today's Board";
    if (boardDate === 'YESTERDAY') return "Yesterday's Board";
    if (boardDate === 'ALL_TIME') return 'All Time';
    return new Date(boardDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  }

  // Team totals
  const teamTotals = stats.reduce((acc, r) => {
    acc.doors += r.doors;
    acc.convos += r.convos;
    acc.sales += r.sales;
    acc.revenue += r.revenue || 0;
    return acc;
  }, { doors: 0, convos: 0, sales: 0, revenue: 0 });
  teamTotals.close_rate = teamTotals.doors > 0 ? ((teamTotals.sales / teamTotals.doors) * 100).toFixed(1) : '0.0';

  return (
    <div className="team-container">

      {/* ── Segment Nav ── */}
      <nav className="team-segment-nav">
        <button
          id="team-seg-leaderboard"
          className={`team-seg-btn ${segment === 'LEADERBOARD' ? 'active' : ''}`}
          onClick={() => setSegment('LEADERBOARD')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10"></line>
            <line x1="12" y1="20" x2="12" y2="4"></line>
            <line x1="6" y1="20" x2="6" y2="14"></line>
          </svg>
          Board
        </button>
        <button
          id="team-seg-activity"
          className={`team-seg-btn ${segment === 'ACTIVITY' ? 'active' : ''}`}
          onClick={() => setSegment('ACTIVITY')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
          </svg>
          Activity
        </button>
        <button
          id="team-seg-sales"
          className={`team-seg-btn ${segment === 'SALES' ? 'active' : ''}`}
          onClick={() => setSegment('SALES')}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10 9 9 9 8 9"></polyline>
          </svg>
          Sales
        </button>
      </nav>

      {/* Date Picker Modal */}
      {showDatePicker && (
        <CustomDatePicker
          currentDate={boardDate}
          onSelect={(iso) => handleDateChange(iso)}
          onClose={() => setShowDatePicker(false)}
        />
      )}

      {/* ════════════════════════════════════
           SEGMENT: LEADERBOARD
         ════════════════════════════════════ */}
      {segment === 'LEADERBOARD' && (
        <div className="team-segment-content">
          {/* Quick Date Tabs */}
          <div className="board-quick-tabs">
            <div className="board-quick-tab-group">
              <button
                id="board-tab-today"
                className={`board-quick-tab ${boardDate === 'TODAY' ? 'active' : ''}`}
                onClick={() => handleDateChange('TODAY')}
              >Today</button>
              <button
                id="board-tab-yesterday"
                className={`board-quick-tab ${boardDate === 'YESTERDAY' ? 'active' : ''}`}
                onClick={() => handleDateChange('YESTERDAY')}
              >Yesterday</button>
              <button
                id="board-tab-alltime"
                className={`board-quick-tab ${boardDate === 'ALL_TIME' ? 'active' : ''}`}
                onClick={() => handleDateChange('ALL_TIME')}
              >All Time</button>
            </div>
            <button
              id="board-date-picker-btn"
              className={`board-cal-btn ${boardDate !== 'TODAY' && boardDate !== 'YESTERDAY' && boardDate !== 'ALL_TIME' ? 'cal-active' : ''}`}
              onClick={() => setShowDatePicker(true)}
              title="Pick a specific date"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              {boardDate !== 'TODAY' && boardDate !== 'YESTERDAY' && boardDate !== 'ALL_TIME' && (
                <span className="cal-active-dot" />
              )}
            </button>
          </div>

          {/* Team Totals */}
          {!loading && stats.length > 0 && (
            <div className="board-team-totals">
              <div className="team-total-item">
                <span className="team-total-val">{teamTotals.doors}</span>
                <span className="team-total-lbl">Doors</span>
              </div>
              <div className="team-total-item">
                <span className="team-total-val" style={{ color: '#3b82f6' }}>{teamTotals.convos}</span>
                <span className="team-total-lbl">Convos</span>
              </div>
              <div className="team-total-item">
                <span className="team-total-val" style={{ color: '#10b981' }}>{teamTotals.sales}</span>
                <span className="team-total-lbl">Sales</span>
              </div>
              <div className="team-total-item">
                <span className="team-total-val" style={{ color: '#f59e0b' }}>{teamTotals.close_rate}%</span>
                <span className="team-total-lbl">Close</span>
              </div>
              {teamTotals.revenue > 0 && (
                <div className="team-total-item">
                  <span className="team-total-val" style={{ color: '#a78bfa' }}>${teamTotals.revenue.toLocaleString()}</span>
                  <span className="team-total-lbl">Revenue</span>
                </div>
              )}
            </div>
          )}

          <div className="team-section-header">
            <h2 className="team-section-title">{getBoardTitle()}</h2>
            <button className="team-refresh-btn" onClick={() => loadData()}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"></polyline>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
              </svg>
            </button>
          </div>

          <div className="leaderboard-list">
            {loading ? (
              [0,1,2].map(i => (
                <div className="lb-skeleton" key={i}>
                  <div className="skel skel-circle" />
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div className="skel skel-line" />
                    <div className="skel skel-line-sm" />
                  </div>
                </div>
              ))
            ) : stats.length === 0 ? (
              <div className="leaderboard-empty">
                <div className="leaderboard-empty-icon">📊</div>
                <p>No activity logged{boardDate === 'TODAY' ? ' today yet' : boardDate === 'ALL_TIME' ? ' yet' : ' on this day'}.</p>
                <p style={{ fontSize: 12, marginTop: 4 }}>{boardDate === 'TODAY' ? 'Start knocking and watch the board fill up.' : 'Try selecting a different date range.'}</p>
              </div>
            ) : (
              stats.map((rep, idx) => {
                const rankClass = idx === 0 ? 'rank-1' : idx === 1 ? 'rank-2' : idx === 2 ? 'rank-3' : '';
                const avatarGrad = AVATAR_COLORS[idx % AVATAR_COLORS.length];
                const isMe = rep.rep_id === user?.id;
                return (
                  <div className={`leaderboard-card ${rankClass}`} key={rep.rep_id}>
                    <span className="lb-rank">
                      {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                    </span>
                    <div className="lb-avatar" style={{ background: avatarGrad }}>
                      {getInitials(rep.rep_name)}
                    </div>
                    <div className="lb-info">
                      <div className="lb-name">
                        {rep.rep_name}{isMe && <span style={{ marginLeft: 6, fontSize: 10, color: '#818cf8', fontWeight: 900 }}>YOU</span>}
                      </div>
                      <div className="lb-stats-row">
                        <div className="lb-stat">
                          <span className="lb-stat-val">{rep.doors}</span>
                          <span className="lb-stat-lbl">Doors</span>
                        </div>
                        <div className="lb-stat">
                          <span className="lb-stat-val" style={{ color: '#3b82f6' }}>{rep.convos}</span>
                          <span className="lb-stat-lbl">Convos</span>
                        </div>
                        <div className="lb-stat">
                          <span className="lb-stat-val" style={{ color: '#10b981' }}>{rep.sales}</span>
                          <span className="lb-stat-lbl">Sales</span>
                        </div>
                        {rep.revenue > 0 && (
                          <div className="lb-stat">
                            <span className="lb-stat-val" style={{ color: '#a78bfa' }}>${rep.revenue.toLocaleString()}</span>
                            <span className="lb-stat-lbl">Rev</span>
                          </div>
                        )}
                        {rep.dph && (
                          <div className="lb-stat">
                            <span className="lb-stat-val" style={{ color: '#f59e0b' }}>{rep.dph}</span>
                            <span className="lb-stat-lbl">DPH</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="lb-close-rate">
                      <CloseRing pct={rep.close_rate} />
                      <span className="lb-close-lbl">Close</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════
           SEGMENT: ACTIVITY (Feed & Radar)
         ════════════════════════════════════ */}
      {segment === 'ACTIVITY' && (
        <div className="team-segment-content" style={{ paddingBottom: 24 }}>
          {/* Team Radar */}
          <div className="team-section-header">
            <h2 className="team-section-title">Team Radar</h2>
            <button className="team-refresh-btn" onClick={loadData}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"></polyline>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
              </svg>
            </button>
          </div>
          <div className="activity-radar-list">
            {activityData.radar.length === 0 ? (
              <div className="activity-empty">No active reps today yet.</div>
            ) : (
              activityData.radar.map((rep, idx) => (
                <div className="radar-card" key={rep.rep_id}>
                  <div className="radar-avatar" style={{ background: AVATAR_COLORS[idx % AVATAR_COLORS.length] }}>
                    {getInitials(rep.rep_name)}
                  </div>
                  <div className="radar-info">
                    <div className="radar-name">{rep.rep_name}{rep.rep_id === user?.id && <span style={{ marginLeft: 6, fontSize: 10, color: '#818cf8', fontWeight: 900 }}>YOU</span>}</div>
                    <div className="radar-loc">{rep.street_name}</div>
                  </div>
                  <div className="radar-time">{getTimeAgo(rep.timestamp)}</div>
                </div>
              ))
            )}
          </div>

          {/* Live Feed */}
          <div className="team-section-header" style={{ marginTop: 12 }}>
            <h2 className="team-section-title">Live Feed</h2>
          </div>
          <div className="activity-feed-list">
            {activityData.feed.length === 0 ? (
              <div className="activity-empty" style={{ marginTop: 24 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🔥</div>
                <p>No wins logged yet today.</p>
              </div>
            ) : (
              activityData.feed.map((event) => {
                const isSale = event.status === 'SALE';
                const isCallback = event.status === 'CALLBACK';
                const color = isSale ? STATUS_COLORS.SALE : isCallback ? STATUS_COLORS.CALLBACK : STATUS_COLORS.CONVO;
                const sd = event.sale_details;
                return (
                  <div className="feed-card" key={event.id}>
                    <div className="feed-icon" style={{ background: `${color}1A`, color: color }}>
                      {isSale ? '💰' : isCallback ? '📅' : '💬'}
                    </div>
                    <div className="feed-content">
                      <div className="feed-text">
                        {isSale && sd ? (
                          <><strong>{event.rep_name}</strong> closed <span style={{ color: '#10b981', fontWeight: 800 }}>{sd.homeowner_name}</span>{sd.job_total ? <span style={{ color: '#a78bfa', fontWeight: 700 }}> · {sd.job_total}</span> : ''}{sd.payment_method ? <span style={{ color: '#8888a0', fontWeight: 500 }}> ({sd.payment_method})</span> : ''}</>
                        ) : (
                          <><strong>{event.rep_name}</strong> got a <span style={{ color, fontWeight: 800 }}>{event.status}</span></>
                        )}
                      </div>
                      <div className="feed-street">
                        {event.street_name}
                        {isSale && sd?.phone && <span style={{ marginLeft: 8, color: '#818cf8', fontSize: 11 }}>{sd.phone}</span>}
                        {isSale && sd?.service_date && <span style={{ marginLeft: 8, color: '#f59e0b', fontSize: 11 }}>{new Date(sd.service_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
                      </div>
                    </div>
                    <div className="feed-time">{getTimeAgo(event.timestamp)}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ════════════════════════════════════
           SEGMENT: SALES BOOK (Persistent)
         ════════════════════════════════════ */}
      {segment === 'SALES' && (
        <div className="team-segment-content">
          {/* Header: title + total revenue */}
          <div className="team-section-header">
            <h2 className="team-section-title">Sales Book</h2>
            <div className="team-total-revenue-pill">
               ${allSales.reduce((sum, s) => {
                 const val = parseFloat(String(s.details?.job_total || '0').replace(/[^0-9.]/g, ''));
                 return sum + (isNaN(val) ? 0 : val);
               }, 0).toLocaleString()}
            </div>
          </div>

          {/* Search bar */}
          <div className="sales-search-wrap">
            <svg className="sales-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              id="sales-search-input"
              className="sales-search-input"
              type="text"
              placeholder="Search homeowner, rep, address…"
              value={salesSearch}
              onChange={e => setSalesSearch(e.target.value)}
            />
            {salesSearch && (
              <button className="sales-search-clear" onClick={() => setSalesSearch('')}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            )}
          </div>

          <div className="sales-book-list">
            {(() => {
              const q = salesSearch.toLowerCase().trim();
              const filtered = q
                ? allSales.filter(s =>
                    (s.details.homeowner_name || '').toLowerCase().includes(q) ||
                    (s.rep_name || '').toLowerCase().includes(q) ||
                    (s.address || '').toLowerCase().includes(q) ||
                    (s.details.phone || '').includes(q) ||
                    (String(s.details.job_total || '')).includes(q)
                  )
                : allSales;

              if (filtered.length === 0) {
                return (
                  <div className="activity-empty">
                    {q ? `No sales matching "${q}"` : 'No sales history found.'}
                  </div>
                );
              }

              return filtered.map((sale) => (
                <div
                  className="sale-book-card"
                  key={sale.id}
                  onTouchStart={() => handleCardPressStart(sale)}
                  onTouchEnd={handleCardPressEnd}
                  onTouchMove={handleCardPressEnd}
                  onMouseDown={() => handleCardPressStart(sale)}
                  onMouseUp={handleCardPressEnd}
                  onMouseLeave={handleCardPressEnd}
                  style={{ cursor: 'pointer', userSelect: 'none', WebkitTouchCallout: 'none' }}
                >
                  <div className="sale-book-header">
                    <div className="sale-book-main">
                      <div className="sale-homeowner">{sale.details.homeowner_name || <span style={{ color: '#55556a', fontStyle: 'italic' }}>Anonymous Customer</span>}</div>
                      <div className="sale-address">{sale.address}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div className="sale-amount-badge">
                        {sale.details.job_total ? `$${sale.details.job_total}` : <span style={{ color: '#55556a' }}>—</span>}
                      </div>
                      <button
                        className="sale-edit-btn"
                        id={`sale-edit-${sale.id}`}
                        onClick={e => { e.stopPropagation(); openEditModal(sale); }}
                        onTouchStart={e => e.stopPropagation()}
                        onMouseDown={e => e.stopPropagation()}
                        title="Edit sale"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                    </div>
                  </div>

                  <div className="sale-details-grid">
                    <div className="sale-detail-item">
                      <span className="sale-detail-lbl">Rep</span>
                      <span className="sale-detail-val">{sale.rep_name}</span>
                    </div>
                    <div className="sale-detail-item">
                      <span className="sale-detail-lbl">Date</span>
                      <span className="sale-detail-val">{new Date(sale.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })}</span>
                    </div>
                    {sale.details.phone && (
                      <div className="sale-detail-item">
                        <span className="sale-detail-lbl">Phone</span>
                        <span className="sale-detail-val" style={{ color: '#818cf8' }}>{sale.details.phone}</span>
                      </div>
                    )}
                    {sale.details.email && (
                      <div className="sale-detail-item">
                        <span className="sale-detail-lbl">Email</span>
                        <span className="sale-detail-val" style={{ color: '#818cf8', fontSize: '10px' }}>{sale.details.email}</span>
                      </div>
                    )}
                    {sale.details.service_date && (
                      <div className="sale-detail-item">
                        <span className="sale-detail-lbl">Service</span>
                        <span className="sale-detail-val" style={{ color: '#f59e0b' }}>{new Date(sale.details.service_date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                      </div>
                    )}
                    {sale.details.payment_method && (
                      <div className="sale-detail-item">
                        <span className="sale-detail-lbl">Pay</span>
                        <span className="sale-detail-val">{sale.details.payment_method}</span>
                      </div>
                    )}
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {/* ── Edit Sale Modal ── */}
      {editSale && (
        <div className="ops-modal-overlay" onClick={() => setEditSale(null)}>
          <div className="ops-modal-content edit-sale-modal" onClick={e => e.stopPropagation()}>
            <div className="ops-modal-header">
              <div>
                <h3 style={{ marginBottom: 2 }}>Edit Sale</h3>
                <div style={{ fontSize: 12, color: '#8888a0' }}>{editSale.address}</div>
              </div>
              <button className="ops-close-btn" onClick={() => setEditSale(null)}>
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div className="edit-form-grid">
              <div className="edit-form-field">
                <label className="edit-form-label">Closed By (Rep)</label>
                <input
                  className="edit-form-input"
                  type="text"
                  placeholder="Rep name"
                  value={editForm.rep_override}
                  onChange={e => setEditForm(f => ({ ...f, rep_override: e.target.value }))}
                />
              </div>
              <div className="edit-form-field">
                <label className="edit-form-label">Homeowner Name</label>
                <input
                  className="edit-form-input"
                  type="text"
                  placeholder="Full name"
                  value={editForm.homeowner_name}
                  onChange={e => setEditForm(f => ({ ...f, homeowner_name: e.target.value }))}
                />
              </div>
              <div className="edit-form-field">
                <label className="edit-form-label">Deal Size ($)</label>
                <input
                  className="edit-form-input"
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 350"
                  value={editForm.job_total}
                  onChange={e => setEditForm(f => ({ ...f, job_total: e.target.value }))}
                />
              </div>
              <div className="edit-form-field">
                <label className="edit-form-label">Phone</label>
                <input
                  className="edit-form-input"
                  type="tel"
                  placeholder="(555) 000-0000"
                  value={editForm.phone}
                  onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
                />
              </div>
              <div className="edit-form-field">
                <label className="edit-form-label">Email</label>
                <input
                  className="edit-form-input"
                  type="email"
                  placeholder="customer@email.com"
                  value={editForm.email}
                  onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="edit-form-field">
                <label className="edit-form-label">Service Date</label>
                <input
                  className="edit-form-input"
                  type="date"
                  value={editForm.service_date}
                  onChange={e => setEditForm(f => ({ ...f, service_date: e.target.value }))}
                />
              </div>
              <div className="edit-form-field">
                <label className="edit-form-label">Payment Method</label>
                <select
                  className="edit-form-input edit-form-select"
                  value={editForm.payment_method}
                  onChange={e => setEditForm(f => ({ ...f, payment_method: e.target.value }))}
                >
                  <option value="">Select…</option>
                  <option value="Cash">Cash</option>
                  <option value="Check">Check</option>
                  <option value="Card">Card</option>
                  <option value="Venmo">Venmo</option>
                  <option value="Zelle">Zelle</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>

            <div className="edit-form-actions">
              <button className="edit-cancel-btn" onClick={() => setEditSale(null)} disabled={saving}>Cancel</button>
              <button className="edit-save-btn" onClick={handleSaveEdit} disabled={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Operations Modal ── */}
      {operationsSale && (
        <div className="ops-modal-overlay" onClick={() => setOperationsSale(null)}>
          <div className="ops-modal-content" onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="ops-modal-header">
              <div>
                <h3 style={{ marginBottom: 2 }}>{operationsSale.details.homeowner_name || 'Anonymous Customer'}</h3>
                <div style={{ fontSize: 12, color: '#8888a0', fontWeight: 500 }}>{operationsSale.address}</div>
              </div>
              <button className="ops-close-btn" onClick={() => setOperationsSale(null)}>
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>

            {/* Sale Details */}
            <div className="ops-section-label">Sale Details</div>
            <div className="ops-sale-details-grid">
              <div className="ops-sale-detail">
                <span className="ops-sale-lbl">Rep</span>
                <span className="ops-sale-val">{operationsSale.rep_name}</span>
              </div>
              <div className="ops-sale-detail">
                <span className="ops-sale-lbl">Date</span>
                <span className="ops-sale-val">{new Date(operationsSale.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })}</span>
              </div>
              {operationsSale.details.phone && (
                <div className="ops-sale-detail">
                  <span className="ops-sale-lbl">Phone</span>
                  <span className="ops-sale-val" style={{ color: '#818cf8' }}>{operationsSale.details.phone}</span>
                </div>
              )}
              {operationsSale.details.email && (
                <div className="ops-sale-detail">
                  <span className="ops-sale-lbl">Email</span>
                  <span className="ops-sale-val" style={{ color: '#818cf8', fontSize: 10 }}>{operationsSale.details.email}</span>
                </div>
              )}
              {operationsSale.details.service_date && (
                <div className="ops-sale-detail">
                  <span className="ops-sale-lbl">Service</span>
                  <span className="ops-sale-val" style={{ color: '#f59e0b' }}>{new Date(operationsSale.details.service_date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                </div>
              )}
              {operationsSale.details.payment_method && (
                <div className="ops-sale-detail">
                  <span className="ops-sale-lbl">Pay</span>
                  <span className="ops-sale-val">{operationsSale.details.payment_method}</span>
                </div>
              )}
            </div>

            {/* Operations Breakdown */}
            <div className="ops-section-label" style={{ marginTop: 20 }}>Operations Breakdown</div>
            {(() => {
              const totalValStr = String(operationsSale.details?.job_total || '0').replace(/[^0-9.]/g, '');
              const jobTotal = parseFloat(totalValStr);
              if (isNaN(jobTotal) || jobTotal <= 0) {
                return <p style={{ color: '#8888a0', textAlign: 'center', marginTop: 12, fontSize: 13 }}>No job total on record.</p>;
              }

              const commissionPct = jobTotal <= 398 ? 0.25 : 0.40;
              const commissionVal = jobTotal * commissionPct;
              const labourCost = 40;
              const companyProfit = jobTotal - commissionVal - labourCost;

              return (
                <div className="ops-calc-grid">
                  <div className="ops-calc-row">
                    <span>Job Total</span>
                    <span style={{ fontWeight: 800 }}>${jobTotal.toFixed(2)}</span>
                  </div>
                  <div className="ops-calc-row">
                    <span>Commission ({commissionPct * 100}%)</span>
                    <span style={{ color: '#10b981' }}>-${commissionVal.toFixed(2)}</span>
                  </div>
                  <div className="ops-calc-row" style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 12, marginBottom: 4 }}>
                    <span>Labour Cost</span>
                    <span style={{ color: '#ef4444' }}>-${labourCost.toFixed(2)}</span>
                  </div>
                  <div className="ops-calc-row ops-total">
                    <span>Net Profit</span>
                    <span style={{ color: companyProfit >= 0 ? '#a78bfa' : '#ef4444' }}>${companyProfit.toFixed(2)}</span>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && (
        <div className={`team-toast ${toast.type}`}>{toast.msg}</div>
      )}
    </div>
  );
}
