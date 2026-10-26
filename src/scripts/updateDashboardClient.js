const fs = require('fs');
const path = require('path');

const jsxFile = path.resolve(__dirname, '../../../client/src/pages/WebinarAdminDashboard.jsx');
const cssFile = path.resolve(__dirname, '../../../client/src/pages/WebinarAdminDashboard.css');

let jsx = fs.readFileSync(jsxFile, 'utf8');

// 1. Add state for selectedWebinarId
const stateOld = `  const [edition, setEdition] = useState('');`;
const stateNew = `  const [edition, setEdition] = useState('');
  const [selectedWebinarId, setSelectedWebinarId] = useState('halal-wealth-nov-2026');`;

if (!jsx.includes('selectedWebinarId')) {
  jsx = jsx.replace(stateOld, stateNew);
}

// 2. Add params.webinarId to registrations fetch
const fetchOld = `    if (to) params.to = to;

    setLoading(true);`;

const fetchNew = `    if (to) params.to = to;
    if (selectedWebinarId) params.webinarId = selectedWebinarId;

    setLoading(true);`;

jsx = jsx.replace(fetchOld, fetchNew);

// Add selectedWebinarId to useEffect dependency array
const depOld = `  }, [page, limit, searchTerm, status, edition, from, to, refreshKey]);`;
const depNew = `  }, [page, limit, searchTerm, status, edition, from, to, refreshKey, selectedWebinarId]);`;
jsx = jsx.replace(depOld, depNew);

// 3. Add params.webinarId to exportRegistrations
const exportOld = `    if (to) params.to = to;
    try {
      const response = await adminApi.get('/api/admin/registrations/export', { params, responseType: 'blob' });`;

const exportNew = `    if (to) params.to = to;
    if (selectedWebinarId) params.webinarId = selectedWebinarId;
    try {
      const response = await adminApi.get('/api/admin/registrations/export', { params, responseType: 'blob' });`;

jsx = jsx.replace(exportOld, exportNew);

// 4. Update joining campaign preview to pass webinarId
const previewOld = `      const response = await adminApi.get('/api/admin/registrations/joining-campaign');`;
const previewNew = `      const response = await adminApi.get('/api/admin/registrations/joining-campaign', {
        params: { webinarId: selectedWebinarId },
      });`;
jsx = jsx.replace(previewOld, previewNew);

// 5. Update sendZoomToPendingRegistrants to pass webinarId
const sendZoomOld = `      const response = await adminApi.post('/api/admin/registrations/send-joining-link', { confirmed: true, delayMs: 250 });`;
const sendZoomNew = `      const response = await adminApi.post('/api/admin/registrations/send-joining-link', {
        confirmed: true,
        delayMs: 250,
        webinarId: selectedWebinarId,
      });`;
jsx = jsx.replace(sendZoomOld, sendZoomNew);

// 6. Update retryFailedZoomRegistrants to pass webinarId
const retryZoomOld = `      const response = await adminApi.post('/api/admin/registrations/send-joining-link', { confirmed: true, retryFailed: true, delayMs: 250 });`;
const retryZoomNew = `      const response = await adminApi.post('/api/admin/registrations/send-joining-link', {
        confirmed: true,
        retryFailed: true,
        delayMs: 250,
        webinarId: selectedWebinarId,
      });`;
jsx = jsx.replace(retryZoomOld, retryZoomNew);

// 7. Update resendAllZoomRegistrants to pass webinarId
const resendZoomOld = `      const response = await adminApi.post('/api/admin/registrations/resend-joining-link', { confirmed: true, delayMs: 250 });`;
const resendZoomNew = `      const response = await adminApi.post('/api/admin/registrations/resend-joining-link', {
        confirmed: true,
        delayMs: 250,
        webinarId: selectedWebinarId,
      });`;
jsx = jsx.replace(resendZoomOld, resendZoomNew);

// 8. Update handleSendStartingReminder to pass webinarId
const reminderOld = `      const response = await adminApi.post('/api/admin/registrations/send-starting-reminder', {
        confirmed: true,
        delayMs: 250,
      });`;
const reminderNew = `      const response = await adminApi.post('/api/admin/registrations/send-starting-reminder', {
        confirmed: true,
        delayMs: 250,
        webinarId: selectedWebinarId,
      });`;
jsx = jsx.replace(reminderOld, reminderNew);

// 9. Update feedback preview to pass webinarId
const feedbackPreviewOld = `      const response = await adminApi.get('/api/admin/campaigns/feedback/preview');`;
const feedbackPreviewNew = `      const response = await adminApi.get('/api/admin/campaigns/feedback/preview', {
        params: { webinarId: selectedWebinarId },
      });`;
jsx = jsx.replace(feedbackPreviewOld, feedbackPreviewNew);

// 10. Update sendFeedbackToEligibleRegistrants to pass webinarId
const sendFeedbackOld = `      const response = await adminApi.post('/api/admin/campaigns/feedback/send', { confirmed: true, delayMs: 250 });`;
const sendFeedbackNew = `      const response = await adminApi.post('/api/admin/campaigns/feedback/send', {
        confirmed: true,
        delayMs: 250,
        webinarId: selectedWebinarId,
      });`;
jsx = jsx.replace(sendFeedbackOld, sendFeedbackNew);

// 11. Update resendFeedbackToAllRegistrants to pass webinarId
const resendFeedbackOld = `      const response = await adminApi.post('/api/admin/campaigns/feedback/resend', { confirmed: true, delayMs: 250 });`;
const resendFeedbackNew = `      const response = await adminApi.post('/api/admin/campaigns/feedback/resend', {
        confirmed: true,
        delayMs: 250,
        webinarId: selectedWebinarId,
      });`;
jsx = jsx.replace(resendFeedbackOld, resendFeedbackNew);

// 12. Update sendPostponementToAllRegistrants to pass webinarId
const sendPostOld = `      const response = await adminApi.post('/api/admin/registrations/send-postponement', { confirmed: true, delayMs: 250 });`;
const sendPostNew = `      const response = await adminApi.post('/api/admin/registrations/send-postponement', {
        confirmed: true,
        delayMs: 250,
        webinarId: selectedWebinarId,
      });`;
jsx = jsx.replace(sendPostOld, sendPostNew);

// 13. Update retryFailedPostponements to pass webinarId
const retryPostOld = `      const response = await adminApi.post('/api/admin/registrations/resend-postponement', { confirmed: true, retryFailed: true, delayMs: 250 });`;
const retryPostNew = `      const response = await adminApi.post('/api/admin/registrations/resend-postponement', {
        confirmed: true,
        retryFailed: true,
        delayMs: 250,
        webinarId: selectedWebinarId,
      });`;
jsx = jsx.replace(retryPostOld, retryPostNew);

// 14. Insert Webinar Event Switcher above title row
const titleRowOld = `      <div className="webinar-admin-content">
        <div className="webinar-admin-title-row">`;

const titleRowNew = `      <div className="webinar-admin-content">
        <section className="webinar-admin-event-switcher-card" aria-label="Webinar selection">
          <div className="webinar-admin-switcher-top">
            <div className="webinar-admin-switcher-select-group">
              <label htmlFor="webinar-event-select" className="webinar-admin-switcher-label">
                SELECT WEBINAR EVENT
              </label>
              <select
                id="webinar-event-select"
                className="webinar-admin-switcher-select"
                value={selectedWebinarId}
                onChange={event => {
                  setSelectedWebinarId(event.target.value);
                  setPage(1);
                }}
              >
                <option value="halal-wealth-nov-2026">Halal Wealth Webinar — Sunday, November 1, 2026 (Upcoming / Active)</option>
                <option value="halal-wealth-oct-2026">Previous Webinar — Sunday, October 18, 2026 (Completed / Historical)</option>
                <option value="all">All Webinars (Combined Overview)</option>
              </select>
            </div>
            <div className="webinar-admin-event-badge-container">
              {selectedWebinarId === 'halal-wealth-nov-2026' && (
                <span className="webinar-status-badge badge-upcoming">● Upcoming Webinar (Nov 1, 2026)</span>
              )}
              {selectedWebinarId === 'halal-wealth-oct-2026' && (
                <span className="webinar-status-badge badge-completed">✓ Completed Webinar (Oct 18, 2026)</span>
              )}
              {selectedWebinarId === 'all' && (
                <span className="webinar-status-badge badge-all">All Webinar Records</span>
              )}
            </div>
          </div>
          <div className="webinar-admin-event-meta-strip">
            <div className="meta-strip-item">
              <span className="meta-label">Topic:</span>
              <span className="meta-value">Halal Trade, Investments &amp; Generational Wealth</span>
            </div>
            <div className="meta-strip-item">
              <span className="meta-label">Date &amp; Time:</span>
              <span className="meta-value">
                {selectedWebinarId === 'halal-wealth-nov-2026'
                  ? 'Sunday, November 1, 2026 — 11:00 AM IST | 1:30 PM SGT | 9:30 AM GST | 8:30 AM AST'
                  : selectedWebinarId === 'halal-wealth-oct-2026'
                  ? 'Sunday, October 18, 2026 — 11:00 AM IST | 1:30 PM SGT | 9:30 AM GST | 8:30 AM AST'
                  : 'All Scheduled Dates &amp; Times'}
              </span>
            </div>
            <div className="meta-strip-item">
              <span className="meta-label">Scoped View:</span>
              <span className="meta-value">
                {selectedWebinarId === 'halal-wealth-nov-2026'
                  ? 'November 1 Registrations Only'
                  : selectedWebinarId === 'halal-wealth-oct-2026'
                  ? 'October 18 Historical Registrations'
                  : 'All Webinar Registrations'}
              </span>
            </div>
          </div>
        </section>

        <div className="webinar-admin-title-row">`;

jsx = jsx.replace(titleRowOld, titleRowNew);

// 15. Update SummaryCard labels to reflect selected webinar
const summaryCardOld = `        <section className="webinar-admin-summary" aria-label="Registration summary">
          <SummaryCard label="Total registrations" value={summary.total} detail="All webinar records" />`;

const summaryCardNew = `        <section className="webinar-admin-summary" aria-label="Registration summary">
          <SummaryCard
            label="Total registrations"
            value={summary.total}
            detail={
              selectedWebinarId === 'halal-wealth-nov-2026'
                ? 'November 1 webinar'
                : selectedWebinarId === 'halal-wealth-oct-2026'
                ? 'October 18 webinar'
                : 'All webinar records'
            }
          />`;

jsx = jsx.replace(summaryCardOld, summaryCardNew);

fs.writeFileSync(jsxFile, jsx, 'utf8');
console.log('Successfully updated WebinarAdminDashboard.jsx');

// Update CSS file for the Event Switcher styling
let css = fs.readFileSync(cssFile, 'utf8');

const eventSwitcherCss = `
/* Webinar Event Switcher Card */
.webinar-admin-event-switcher-card {
  background: linear-gradient(135deg, #0d1e38 0%, #081326 100%);
  border: 1px solid rgba(212, 175, 55, 0.35);
  border-radius: 12px;
  padding: 1.25rem 1.5rem;
  margin-bottom: 1.5rem;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
}

.webinar-admin-switcher-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.webinar-admin-switcher-select-group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  flex: 1;
  min-width: 280px;
}

.webinar-admin-switcher-label {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #d4af37;
  text-transform: uppercase;
}

.webinar-admin-switcher-select {
  background: #060e1a;
  color: #ffffff;
  border: 1px solid rgba(212, 175, 55, 0.5);
  border-radius: 8px;
  padding: 0.6rem 0.85rem;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.webinar-admin-switcher-select:focus {
  border-color: #d4af37;
  box-shadow: 0 0 0 3px rgba(212, 175, 55, 0.2);
}

.webinar-admin-switcher-select option {
  background: #0d1e38;
  color: #ffffff;
}

.webinar-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  font-weight: 600;
  padding: 0.4rem 0.85rem;
  border-radius: 20px;
  letter-spacing: 0.02em;
}

.badge-upcoming {
  background: rgba(34, 197, 94, 0.15);
  color: #4ade80;
  border: 1px solid rgba(34, 197, 94, 0.4);
}

.badge-completed {
  background: rgba(148, 163, 184, 0.15);
  color: #cbd5e1;
  border: 1px solid rgba(148, 163, 184, 0.3);
}

.badge-all {
  background: rgba(212, 175, 55, 0.15);
  color: #facc15;
  border: 1px solid rgba(212, 175, 55, 0.4);
}

.webinar-admin-event-meta-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
  padding-top: 0.85rem;
  font-size: 0.85rem;
}

.meta-strip-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.meta-label {
  color: #94a3b8;
  font-weight: 500;
}

.meta-value {
  color: #f1f5f9;
  font-weight: 600;
}
`;

if (!css.includes('webinar-admin-event-switcher-card')) {
  css += eventSwitcherCss;
  fs.writeFileSync(cssFile, css, 'utf8');
  console.log('Successfully updated WebinarAdminDashboard.css');
}

