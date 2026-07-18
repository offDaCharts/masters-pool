(function () {
    'use strict';

    let config = {
        eventName: 'Golf Tournament',
        courseName: '',
        coursePars: [],
        getGolfer: () => null,
    };
    let lastFocused = null;

    function escapeHTML(value) {
        return String(value ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function parseRelative(value) {
        if (value === null || value === undefined || value === '' || value === '-') return null;
        if (value === 'E') return 0;
        const parsed = Number.parseInt(String(value), 10);
        return Number.isFinite(parsed) ? parsed : null;
    }

    function formatRelative(value) {
        if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
        const number = Number(value);
        if (number === 0) return 'E';
        return number > 0 ? `+${number}` : String(number);
    }

    function teeTimeFromRound(round) {
        const categories = Array.isArray(round?.statistics?.categories)
            ? round.statistics.categories
            : [];
        for (const category of categories) {
            const stats = Array.isArray(category?.stats) ? category.stats : [];
            for (const stat of stats) {
                const value = stat?.displayValue;
                if (typeof value !== 'string' || !value.includes(':')) continue;
                const timestamp = Date.parse(value);
                if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
            }
        }
        return null;
    }

    function formatTeeTime(value) {
        if (!value) return '';
        const date = new Date(value);
        if (!Number.isFinite(date.getTime())) return '';
        return new Intl.DateTimeFormat(undefined, {
            hour: 'numeric',
            minute: '2-digit',
            timeZoneName: 'short',
        }).format(date);
    }

    function roundsFromCompetitor(competitor) {
        const rounds = Array.isArray(competitor?.linescores) ? competitor.linescores : [];
        return rounds
            .filter(round => Number.isFinite(Number(round?.period)))
            .map(round => {
                const holes = (Array.isArray(round.linescores) ? round.linescores : []).map(hole => {
                    const strokes = Number.isFinite(Number(hole.value)) ? Number(hole.value) : null;
                    const toPar = parseRelative(hole.scoreType?.displayValue);
                    return {
                        number: Number(hole.period),
                        strokes,
                        toPar,
                        par: strokes !== null && toPar !== null ? strokes - toPar : null,
                    };
                });
                const notStarted = holes.length === 0
                    && (round.displayValue === '-' || Number(round.value) === 0);
                return {
                    number: Number(round.period),
                    strokes: !notStarted && Number.isFinite(Number(round.value))
                        ? Number(round.value)
                        : null,
                    toPar: notStarted ? null : parseRelative(round.displayValue),
                    holes,
                    teeTime: notStarted ? teeTimeFromRound(round) : null,
                };
            })
            .sort((a, b) => a.number - b.number);
    }

    function button(playerName, label, className) {
        const safeName = escapeHTML(playerName);
        const safeLabel = escapeHTML(label ?? playerName);
        const classes = ['player-scorecard-trigger', className || ''].filter(Boolean).join(' ');
        return `<button type="button" class="${classes}" data-player-name="${safeName}" aria-label="View full scorecard for ${safeName}">${safeLabel}</button>`;
    }

    function ensureModal() {
        let modal = document.getElementById('playerScorecardModal');
        if (modal) return modal;
        modal = document.createElement('div');
        modal.id = 'playerScorecardModal';
        modal.className = 'scorecard-modal';
        modal.hidden = true;
        modal.innerHTML = `
            <div class="scorecard-modal-backdrop" data-scorecard-close></div>
            <section class="scorecard-dialog" role="dialog" aria-modal="true" aria-labelledby="scorecardPlayerName">
                <header class="scorecard-header">
                    <div>
                        <div class="scorecard-eyebrow" id="scorecardEventName"></div>
                        <h2 class="scorecard-title" id="scorecardPlayerName">Player scorecard</h2>
                        <div class="scorecard-subtitle" id="scorecardCourseName"></div>
                    </div>
                    <button class="scorecard-close" type="button" data-scorecard-close aria-label="Close scorecard">&times;</button>
                </header>
                <div class="scorecard-content" id="scorecardContent"></div>
            </section>`;
        document.body.appendChild(modal);
        return modal;
    }

    function scoreClass(toPar) {
        if (toPar === null || toPar === 0) return '';
        if (toPar <= -2) return 'eagle';
        if (toPar === -1) return 'birdie';
        if (toPar === 1) return 'bogey';
        return 'double';
    }

    function renderNine(rounds, startHole, title) {
        const holeNumbers = Array.from({ length: 9 }, (_, index) => startHole + index);
        const configuredPars = config.coursePars || [];
        const pars = holeNumbers.map(number => {
            const configured = configuredPars[number - 1];
            if (Number.isFinite(configured)) return configured;
            for (const round of rounds) {
                const inferred = round.holes.find(hole => hole.number === number)?.par;
                if (Number.isFinite(inferred)) return inferred;
            }
            return null;
        });
        const parTotal = pars.every(Number.isFinite) ? pars.reduce((sum, par) => sum + par, 0) : '—';
        const heading = holeNumbers.map(number => `<th scope="col">${number}</th>`).join('');
        const parCells = pars.map(par => `<td>${Number.isFinite(par) ? par : '—'}</td>`).join('');
        const roundRows = rounds.map(round => {
            const holes = holeNumbers.map(number => round.holes.find(hole => hole.number === number));
            const played = holes.filter(hole => Number.isFinite(hole?.strokes));
            const nineTotal = played.length ? played.reduce((sum, hole) => sum + hole.strokes, 0) : '—';
            const cells = holes.map(hole => {
                if (!hole || !Number.isFinite(hole.strokes)) return '<td>—</td>';
                const cls = scoreClass(hole.toPar);
                return `<td><span class="score-mark ${cls}" title="${formatRelative(hole.toPar)} on the hole">${hole.strokes}</span></td>`;
            }).join('');
            return `<tr><th class="row-label" scope="row">R${round.number}</th>${cells}<td class="total-column">${nineTotal}</td></tr>`;
        }).join('');

        return `
            <section class="scorecard-nine">
                <h3 class="scorecard-nine-title">${title}</h3>
                <div class="scorecard-table-wrap">
                    <table class="scorecard-table">
                        <thead><tr><th class="row-label" scope="col">Hole</th>${heading}<th class="total-column" scope="col">${startHole === 1 ? 'Out' : 'In'}</th></tr></thead>
                        <tbody>
                            <tr class="par-row"><th class="row-label" scope="row">Par</th>${parCells}<td class="total-column">${parTotal}</td></tr>
                            ${roundRows}
                        </tbody>
                    </table>
                </div>
            </section>`;
    }

    function open(playerName) {
        const modal = ensureModal();
        const golfer = config.getGolfer(playerName);
        if (!golfer) return;
        const rounds = Array.isArray(golfer.rounds) ? golfer.rounds : [];
        const overall = Number(golfer.score) === 999 ? '—' : formatRelative(Number(golfer.score));
        const status = golfer.status === 'active' ? (golfer.thru || 'In progress') : (golfer.status || golfer.thru || '');
        const chips = rounds.map(round => {
            const strokes = Number.isFinite(round.strokes) ? round.strokes : '—';
            const detail = round.toPar === null ? '' : `<span class="scorecard-chip-detail">${formatRelative(round.toPar)}</span>`;
            const teeTime = formatTeeTime(round.teeTime);
            const teeTimeHTML = teeTime
                ? `<span class="scorecard-chip-tee-time">Tee ${escapeHTML(teeTime)}</span>`
                : '';
            return `<div class="scorecard-round-chip"><span class="scorecard-chip-label">Round ${round.number}</span><span class="scorecard-chip-score">${strokes}</span>${detail}${teeTimeHTML}</div>`;
        }).join('');
        const empty = rounds.some(round => round.holes.length)
            ? ''
            : '<div class="scorecard-empty">Hole-by-hole scores will appear here once this player begins the tournament.</div>';

        document.getElementById('scorecardEventName').textContent = config.eventName;
        document.getElementById('scorecardPlayerName').textContent = golfer.name || playerName;
        document.getElementById('scorecardCourseName').textContent = [config.courseName, status].filter(Boolean).join(' • ');
        document.getElementById('scorecardContent').innerHTML = `
            <div class="scorecard-overview">
                <div class="scorecard-overall"><span class="scorecard-chip-label">Tournament</span><span class="scorecard-chip-score">${overall}</span></div>
                ${chips}
            </div>
            ${empty}
            ${renderNine(rounds, 1, 'Front Nine')}
            ${renderNine(rounds, 10, 'Back Nine')}
            <div class="scorecard-legend"><span class="under">Birdie or better</span><span class="over">Bogey or worse</span></div>`;

        lastFocused = document.activeElement;
        modal.hidden = false;
        document.body.classList.add('scorecard-open');
        modal.querySelector('.scorecard-close').focus();
    }

    function close() {
        const modal = document.getElementById('playerScorecardModal');
        if (!modal || modal.hidden) return;
        modal.hidden = true;
        document.body.classList.remove('scorecard-open');
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    }

    document.addEventListener('click', event => {
        const trigger = event.target.closest('.player-scorecard-trigger');
        if (trigger) {
            open(trigger.dataset.playerName);
            return;
        }
        if (event.target.closest('[data-scorecard-close]')) close();
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') close();
    });

    window.PlayerScorecard = {
        button,
        configure(options) { config = { ...config, ...options }; },
        formatTeeTime,
        roundsFromCompetitor,
        open,
        close,
    };
})();
