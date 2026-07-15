// ==UserScript==
// @name         韩师抢课助手
// @namespace    https://gitee.com/mangohia/hstc-course-grabber
// @version      3.7
// @description  韩山师范学院自动抢选修课 — 输入课程、设置时间、自动刷新页面、到点自动开抢
// @author       mangohia
// @match        *://*/*eams/*
// @match        http://localhost:8888/*
// @match        http://127.0.0.1:8888/*
// @icon         https://www.hstc.edu.cn/favicon.ico
// @downloadURL  https://gitee.com/mangohia/hstc-course-grabber/raw/main/韩师抢课助手.user.js
// @updateURL    https://gitee.com/mangohia/hstc-course-grabber/raw/main/韩师抢课助手.user.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ===== 配置区 =====
    const AUTO_CHECK = true;              // 抢完后自动切到「已选课程」标签
    const CONFIRM_WAIT = 1500;            // 点击选课后等弹窗的时间(ms)
    const DEFAULT_REFRESH_INTERVAL = 30;  // 自动刷新间隔(秒)
    const LS_KEY = 'hstc_grabber_v2';     // localStorage 存储键
    const SCRIPT_VER = '3.7';  // ↑ 改 @version 时同步改这里

    // ===== 状态 =====
    let status = {
        courses: [],
        clicked: [],
        confirmed: [],
        started: false,
        stopped: false,
        timer: null,
        done: false
    };

    let refreshTimer = null;  // 页面刷新定时器

    // ========================
    //  localStorage 持久化
    // ========================

    function saveSession(data) {
        data._ts = Date.now();
        localStorage.setItem(LS_KEY, JSON.stringify(data));
    }

    function loadSession() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            if (!data.targetTime || !data.courses || data.courses.length === 0) {
                localStorage.removeItem(LS_KEY);
                return null;
            }
            return data;
        } catch (e) {
            localStorage.removeItem(LS_KEY);
            return null;
        }
    }

    function clearSession() {
        localStorage.removeItem(LS_KEY);
    }

    // ========================
    //  面板 UI
    // ========================

    function makeDraggable(el) {
        const handle = el.querySelector('#hstc-drag-handle');
        let isDown = false, offX, offY;
        handle.addEventListener('mousedown', e => {
            isDown = true;
            const rect = el.getBoundingClientRect();
            offX = e.clientX - rect.left;
            offY = e.clientY - rect.top;
            el.style.cursor = 'grabbing';
            el.style.right = 'auto';
            el.style.bottom = 'auto';
        });
        document.addEventListener('mousemove', e => {
            if (!isDown) return;
            el.style.left = (e.clientX - offX) + 'px';
            el.style.top = (e.clientY - offY) + 'px';
        });
        document.addEventListener('mouseup', () => {
            if (!isDown) return;
            isDown = false;
            el.style.cursor = '';
        });
    }

    function updateCountdown(text, subText) {
        const el = document.getElementById('hstc-countdown');
        if (el) el.textContent = text;
        const sub = document.getElementById('hstc-countdown-sub');
        if (sub) {
            sub.textContent = subText || '';
            sub.style.display = subText ? 'block' : 'none';
        }
    }

    function addLog(msg) {
        const el = document.getElementById('hstc-log');
        if (el) {
            const t = new Date().toLocaleTimeString();
            el.innerHTML += `<div>[${t}] ${msg}</div>`;
            el.scrollTop = el.scrollHeight;
        }
        console.log(`[抢课助手] ${msg}`);
    }

    // 重置界面到初始状态（显示输入框，清空课程状态）
    function resetUI() {
        const input = document.getElementById('hstc-course-input');
        if (input) input.style.display = 'block';
        const statusDiv = document.getElementById('hstc-course-status');
        if (statusDiv) {
            statusDiv.innerHTML = '';
            statusDiv.style.display = 'none';
        }
        updateCountdown('输入课程名，选择开抢时间 🚀');
    }

    function createPanel(htmlContent) {
        // 防止重复创建
        if (document.getElementById('hstc-grabber-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'hstc-grabber-panel';
        panel.style.cssText = `
            position: fixed; top: 20px; right: 20px; width: 310px;
            background: #fff; border: 2px solid #238FBF; border-radius: 12px;
            padding: 16px; padding-top: 0; z-index: 99999;
            font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
            box-shadow: 0 4px 20px rgba(0,0,0,0.2); font-size: 14px;
        `;
        panel.innerHTML = htmlContent;
        document.body.appendChild(panel);
        makeDraggable(panel);
        return panel;
    }

    // 生成小时/分钟下拉框
    function timeSelectOptions() {
        const hrs = Array.from({length: 24}, (_, i) =>
            `<option value="${i}">${String(i).padStart(2,'0')}时</option>`).join('');
        const mins = Array.from({length: 60}, (_, i) =>
            `<option value="${i}">${String(i).padStart(2,'0')}分</option>`).join('');
        return { hrs, mins };
    }

    function buildInputPanelHTML() {
        const { hrs, mins } = timeSelectOptions();
        return `
            <div id="hstc-drag-handle" style="cursor:move;user-select:none;padding:12px 0;margin-bottom:4px;font-weight:bold;font-size:16px;color:#238FBF;">
                🎯 韩师抢课助手 <span style="font-weight:normal;font-size:11px;color:#999;">v${SCRIPT_VER}</span>
            </div>

            <div id="hstc-countdown" style="font-size:18px;font-weight:bold;color:#333;text-align:center;padding:8px;background:#f0f7ff;border-radius:8px;margin-bottom:8px;">
                输入课程名，选择开抢时间 🚀
            </div>
            <div id="hstc-countdown-sub" style="font-size:12px;color:#888;text-align:center;margin-bottom:8px;display:none;"></div>

            <div style="background:#fafafa;border-radius:8px;padding:10px;margin-bottom:10px;">
                <div style="margin-bottom:6px;color:#555;font-size:13px;">⏰ 开抢时间</div>
                <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;">
                    <select id="hstc-hour" style="flex:1;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:13px;">${hrs}</select>
                    <select id="hstc-minute" style="flex:1;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:13px;">${mins}</select>
                </div>
                <div style="display:flex;align-items:center;gap:6px;font-size:13px;color:#555;">
                    <input type="checkbox" id="hstc-auto-refresh" checked style="accent-color:#238FBF;">
                    <label for="hstc-auto-refresh">自动刷新页面保活</label>
                    <select id="hstc-refresh-interval" style="margin-left:auto;padding:2px 4px;border:1px solid #ddd;border-radius:4px;font-size:12px;">
                        <option value="15">15秒</option>
                        <option value="30" selected>30秒</option>
                        <option value="60">60秒</option>
                    </select>
                </div>
            </div>

            <div style="margin-bottom:4px;color:#666;font-size:13px;">
                目标课程（每行一个）：
            </div>
            <div style="margin-bottom:8px;">
                <textarea id="hstc-course-input" rows="3" style="
                    width:100%;box-sizing:border-box;padding:6px 8px;
                    border:1px solid #ddd;border-radius:6px;font-size:13px;
                    resize:vertical;font-family:inherit;
                " placeholder="舌尖上的潮州菜&#10;财经新闻与理财&#10;（输入课程名 或 课程序号均可）"></textarea>
            </div>

            <div id="hstc-course-status" style="margin-bottom:8px;display:none;"></div>

            <div style="text-align:center;margin-top:6px;">
                <button id="hstc-action-btn" style="
                    background:#238FBF;color:#fff;border:none;padding:8px 24px;
                    border-radius:6px;cursor:pointer;font-size:14px;font-weight:bold;
                ">🚀 启动自动模式</button>
            </div>
            <div style="font-size:11px;color:#aaa;text-align:center;margin-top:4px;">
                或点击「立即开抢」直接手动抢课
            </div>

            <div style="text-align:center;margin-top:4px;">
                <button id="hstc-manual-start" style="
                    background:#e67e22;color:#fff;border:none;padding:4px 16px;
                    border-radius:4px;cursor:pointer;font-size:12px;
                ">⚡ 立即开抢（手动）</button>
            </div>

            <div id="hstc-log" style="font-size:12px;color:#999;border-top:1px solid #eee;padding-top:8px;margin-top:8px;max-height:80px;overflow-y:auto;">
                ✅ 脚本已加载 — 输入课程、设置时间、点击启动 🚀
            </div>
        `;
    }

    function buildRunningPanelHTML() {
        return `
            <div id="hstc-drag-handle" style="cursor:move;user-select:none;padding:12px 0;margin-bottom:4px;font-weight:bold;font-size:16px;color:#238FBF;">
                🎯 韩师抢课助手 <span style="font-weight:normal;font-size:11px;color:#999;">v${SCRIPT_VER}</span>
            </div>

            <div id="hstc-countdown" style="font-size:18px;font-weight:bold;color:#333;text-align:center;padding:8px;background:#f0f7ff;border-radius:8px;margin-bottom:8px;">
                ⏰ 00:00:00
            </div>
            <div id="hstc-countdown-sub" style="font-size:12px;color:#888;text-align:center;margin-bottom:8px;"></div>

            <div id="hstc-course-status" style="margin-bottom:8px;"></div>
            <div style="text-align:center;margin-top:6px;">
                <button id="hstc-cancel-btn" style="
                    background:#e74c3c;color:#fff;border:none;padding:6px 20px;
                    border-radius:6px;cursor:pointer;font-size:13px;
                ">✖ 取消自动刷新</button>
            </div>
            <div id="hstc-log" style="font-size:12px;color:#999;border-top:1px solid #eee;padding-top:8px;margin-top:8px;max-height:80px;overflow-y:auto;">
                ✅ 自动模式已启动
            </div>
        `;
    }

    // ========================
    //  抢课核心逻辑（不变）
    // ========================

    function findAllCourseButtons() {
        const buttons = [];
        const links = document.querySelectorAll('a.lessonListOperator[operator="ELECTION"]');
        for (const el of links) {
            if (el.textContent && el.textContent.trim() === '选课') {
                const row = el.closest('tr') || el.parentElement;
                if (row) {
                    const cells = row.querySelectorAll('td');
                    // 收集所有单元格文本，逐一匹配
                    const cellTexts = Array.from(cells).map(c => c.textContent.trim());
                    buttons.push({
                        element: el,
                        cellTexts: cellTexts
                    });
                }
            }
        }
        return buttons;
    }

    function updateCourseStatus(index, text, color) {
        const el = document.querySelector(`#hstc-course-${index} span:last-child`);
        if (el) {
            el.textContent = text;
            el.style.color = color || '#999';
        }
    }

    function switchToSelectedTab() {
        const all = document.querySelectorAll('a, span, div');
        for (const el of all) {
            if (el.textContent && el.textContent.trim() === '已选课程') {
                el.click();
                addLog('📋 已切换到「已选课程」标签查看结果');
                break;
            }
        }
    }

    function handleConfirm(courseName, index) {
        const confirmBtn = document.querySelector(
            '.dialog-confirm button, .confirm-btn, .messager-button .l-btn, [class*="confirm"] a, .dialog-button a:first-child'
        );
        if (confirmBtn) {
            addLog(`✅ 「${courseName}」弹窗确认中...`);
            confirmBtn.click();
            updateCourseStatus(index, '✅ 已抢到！', '#0a0');
            status.confirmed.push(index);
        } else {
            const dialog = document.querySelector(
                '.dialog, .messager-window, [class*="dialog"], [role="dialog"]'
            );
            if (dialog && dialog.style.display !== 'none') {
                const btns = dialog.querySelectorAll('a, button, span');
                for (const btn of btns) {
                    const txt = btn.textContent || '';
                    if (txt.includes('确定') || txt.includes('确认') || txt.includes('是')) {
                        addLog(`✅ 「${courseName}」弹窗确认中...`);
                        btn.click();
                        updateCourseStatus(index, '✅ 已抢到！', '#0a0');
                        status.confirmed.push(index);
                        return;
                    }
                }
            }
            setTimeout(() => {
                const dialog2 = document.querySelector(
                    '.dialog, .messager-window, [class*="dialog"], [role="dialog"]'
                );
                if (dialog2 && dialog2.style.display !== 'none') {
                    const btns = dialog2.querySelectorAll('a, button, span');
                    for (const btn of btns) {
                        const txt = btn.textContent || '';
                        if (txt.includes('确定') || txt.includes('确认') || txt.includes('是')) {
                            btn.click();
                            updateCourseStatus(index, '✅ 已抢到！', '#0a0');
                            status.confirmed.push(index);
                            return;
                        }
                    }
                }
                addLog(`⚠️ 未检测到弹窗，可能已直接选课成功`);
                updateCourseStatus(index, '✅ 已提交', '#0a0');
                status.confirmed.push(index);
            }, 2000);
        }
    }

    function startGrabbing(courses) {
        if (status.started) return;
        status.started = true;
        status.stopped = false;
        status.courses = courses || [];

        if (status.courses.length === 0) {
            addLog('⚠️ 请先输入至少一个课程名称');
            updateCountdown('⚠️ 未输入课程名');
            status.started = false;
            return;
        }

        // 尝试把每页显示调到最大，让所有课程出现在一页
        try {
            const pageSelect = document.querySelector('select[name="pageSize"], select[id*="pageSize"], select[id*="PageSize"]');
            if (pageSelect) {
                const nums = Array.from(pageSelect.options).map(o => parseInt(o.value)).filter(n => n > 0);
                const max = Math.max(...nums, 0);
                if (max > 0 && parseInt(pageSelect.value) < max) {
                    pageSelect.value = max;
                    pageSelect.dispatchEvent(new Event('change'));
                    addLog(`📄 已切换每页显示 ${max} 条，全部课程可见`);
                }
            }
        } catch (e) { /* 静默失败 */ }

        // 检测分页，准备自动翻页
        let pagTotal = 0, pagTarget = 1, pagGoingBack = true, pagPendingNav = false, pagWaitTicks = 0;
        try {
            const allP = document.querySelectorAll('a[pageno]');
            for (const el of allP) {
                const n = parseInt(el.getAttribute('pageno'));
                if (n > pagTotal) pagTotal = n;
            }
            if (pagTotal > 1) {
                // 先判断当前在第几页，再决定方向
                const curEl = document.querySelector('a.pgButtonHover, a.current, a.active');
                let curPage = 1;
                if (curEl) {
                    const cn = parseInt(curEl.getAttribute('pageno') || curEl.textContent.trim());
                    if (cn > 0) { curPage = cn; pagTarget = cn; }
                }
                // 如果已经在第1页，直接向前翻；否则先往回翻
                pagGoingBack = curPage > 1;
                if (pagGoingBack) addLog(`📄 从第${curPage}页往回翻到第1页`);
                else addLog(`📄 从第1页开始向前扫描`);
            }
        } catch (e) { /* 静默 */ }

        addLog(`🚀 开始抢课！目标: ${status.courses.join(', ')}`);

        // 隐藏输入区，显示课程状态
        const input = document.getElementById('hstc-course-input');
        if (input) input.style.display = 'none';

        const statusDiv = document.querySelector('#hstc-course-status');
        if (statusDiv) {
            statusDiv.style.display = 'block';
            statusDiv.innerHTML = status.courses.map((name, i) => `
                <div id="hstc-course-${i}" style="padding:4px 8px;margin:4px 0;border-radius:6px;background:#f5f5f5;display:flex;justify-content:space-between;align-items:center;">
                    <span>${name}</span>
                    <span style="font-size:12px;color:#999;">⏳ 等待中</span>
                </div>
            `).join('');
        }

        let attempts = 0;
        const maxAttempts = 600;

        function attemptGrab() {
            if (status.stopped) return;

            try {
            if (pagPendingNav) {
                pagWaitTicks++;
                if (pagWaitTicks < 3) {
                    status.timer = setTimeout(attemptGrab, 500);
                    return;
                }
                pagPendingNav = false;
                pagWaitTicks = 0;
                // 翻页后重新检测当前页
                try { const pe = document.querySelector('a.pgButtonHover, a.current, a.active'); if (pe) { const pn = parseInt(pe.getAttribute('pageno') || pe.textContent.trim()); if (pn > 0) pagTarget = pn; } } catch {}
                addLog(`📄 已到第 ${pagTarget} 页，开始扫描`);
            }

            attempts++;
            addLog(`第 ${attempts} 次尝试...`);

            try {
                const allBtns = findAllCourseButtons();

                status.courses.forEach((courseName, index) => {
                    if (status.confirmed.includes(index)) return;

                    let found = false;
                    for (const btnInfo of allBtns) {
                        // 逐一检查每个单元格，匹配即可
                        const match = btnInfo.cellTexts.some(t => t.includes(courseName));
                        if (match) {
                            found = true;
                            if (!status.clicked.includes(index)) {
                                addLog(`🎯 找到「${courseName}」，正在点击选课...`);
                                updateCourseStatus(index, '🔄 点击中...', '#f90');
                                btnInfo.element.click();
                                status.clicked.push(index);

                                setTimeout(() => {
                                    handleConfirm(courseName, index);
                                }, CONFIRM_WAIT);
                            }
                            break;
                        }
                    }

                    if (!found && !status.clicked.includes(index)) {
                        updateCourseStatus(index, '🔍 未出现', '#999');
                    }
                });
            } catch (e) {
                addLog(`⚠️ 抢课循环异常: ${e.message}`);
            }

            // 检查是否全部完成
            if (status.confirmed.length === status.courses.length) {
                status.stopped = true;
                if (status.timer) { clearTimeout(status.timer); status.timer = null; }
                addLog('✅ 全部课程已抢到！');
                updateCountdown('✅ 全部完成！');
                status.done = true;
                status.started = false;
                const manualBtn = document.getElementById('hstc-manual-start');
                if (manualBtn) { manualBtn.textContent = '🔄 重新开抢'; manualBtn.style.background = '#238FBF'; manualBtn.disabled = false; }
                if (AUTO_CHECK) {
                    setTimeout(switchToSelectedTab, 1000);
                }
                return;
            }

            // 翻页：用 a[pageno] 跳页（比搜"上一页""下一页"文本更可靠）
            if (pagTotal > 1 && !status.stopped && !pagPendingNav) {
                pagWaitTicks++;
                if (pagWaitTicks >= 1) {
                    pagWaitTicks = 0;
                    let targetPage = null;
                    // 获取当前页码
                    let curPage = 0;
                    try {
                        const curEl = document.querySelector('a.pgButtonHover, a.current, a.active');
                        if (curEl) curPage = parseInt(curEl.getAttribute('pageno') || curEl.textContent.trim()) || 0;
                    } catch {}
                    if (pagGoingBack) {
                        // 找小于当前页的最大可见页码（逐步往回翻）
                        try {
                            const allLinks = document.querySelectorAll('a[pageno]:not(.disabled)');
                            for (const el of allLinks) {
                                const n = parseInt(el.getAttribute('pageno'));
                                if (n > 0 && n < (curPage || pagTotal) && (targetPage === null || n > targetPage)) {
                                    targetPage = n;
                                }
                            }
                        } catch {}
                        if (targetPage === null) {
                            // 没有更小的页码了 → 已在第1页
                            pagGoingBack = false;
                            addLog('📄 已在第1页，开始向前翻');
                        }
                    } else {
                        // 向前翻：当前页 + 1
                        if (curPage > 0) targetPage = curPage + 1;
                    }
                    if (targetPage !== null && targetPage <= pagTotal) {
                        const link = document.querySelector(`a[pageno="${targetPage}"]`);
                        if (link && !link.disabled && !link.classList.contains('disabled')) {
                            link.click();
                            pagPendingNav = true;
                            if (targetPage <= curPage) {
                                addLog(`📄 跳到第 ${targetPage} 页（往回）`);
                            } else {
                                addLog(`📄 跳到第 ${targetPage} 页`);
                            }
                        } else {
                            // 目标页链接不可用
                            if (pagGoingBack) {
                                pagGoingBack = false;
                                addLog('📄 无法往回跳，开始向前翻');
                            } else {
                                pagTotal = 0;
                                addLog('📄 已扫描完所有页面');
                            }
                        }
                    }
                }
            }

            if (attempts < maxAttempts && !status.stopped) {
                status.timer = setTimeout(attemptGrab, 500);
            } else if (!status.stopped) {
                addLog('⏰ 尝试次数已达上限，请手动操作');
                updateCountdown('⚠️ 请手动操作');
                status.done = true;
                status.started = false;
                const manualBtn = document.getElementById('hstc-manual-start');
                if (manualBtn) { manualBtn.textContent = '🔄 重新开抢'; manualBtn.style.background = '#238FBF'; manualBtn.disabled = false; }
            }
        } catch (e) {
            addLog(`❌ attemptGrab 异常: ${e.message}`);
            // 错误后继续循环，不卡死
            if (!status.stopped && attempts < maxAttempts) {
                status.timer = setTimeout(attemptGrab, 500);
            }
        }
        }

        attemptGrab();
    }

    // ========================
    //  自动刷新 + 倒计时
    // ========================

    function stopRefreshCycle() {
        if (refreshTimer) {
            clearTimeout(refreshTimer);
            refreshTimer = null;
        }
        clearSession();
    }

    /**
     * 启动"等待 → 定时刷新"循环
     * @param {string[]} courses - 课程列表
     * @param {number} targetTime - 目标时间戳(ms)
     * @param {number} refreshIntervalSec - 刷新间隔(秒)
     */
    function startAutoRefreshCycle(courses, targetTime, refreshIntervalSec) {
        // 保存到 localStorage（让页面刷新后能恢复）
        saveSession({
            courses: courses,
            targetTime: targetTime,
            refreshInterval: refreshIntervalSec
        });

        runCountdownLoop(courses, targetTime, refreshIntervalSec);
    }

    function runCountdownLoop(courses, targetTime, refreshIntervalSec) {
        if (status.started || status.done) return;

        const now = Date.now();
        const remaining = targetTime - now;

        if (remaining <= 2000) {
            // 时间到了或马上到 → 清除状态 → 开抢
            addLog('⏰ 开抢时间已到！开始抢课！');
            updateCountdown('🚀 开抢！');
            clearSession();
            stopRefreshCycle();
            startGrabbing(courses);
            return;
        }

        // 显示倒计时
        const totalSec = Math.floor(remaining / 1000);
        const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
        const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
        const s = String(totalSec % 60).padStart(2, '0');
        updateCountdown(`⏰ ${h}:${m}:${s}`, `🔄 页面将自动刷新保活，每 ${refreshIntervalSec} 秒一次`);

        // 计算下次刷新的时间
        // 如果剩余时间 < (refreshInterval + 5)秒，就提前刷新确保最后时刻在页面上
        const refreshMs = refreshIntervalSec * 1000;
        const nextRefresh = Math.min(refreshMs, remaining - 2000);
        const actualDelay = Math.max(2000, nextRefresh);  // 至少2秒

        addLog(`🔄 页面将在 ${Math.round(actualDelay/1000)} 秒后自动刷新...（距开抢还有 ${totalSec} 秒）`);

        // 更新倒计时（每秒一次）
        let countdownInterval = setInterval(() => {
            const now2 = Date.now();
            const rem2 = targetTime - now2;
            if (rem2 <= 0) {
                clearInterval(countdownInterval);
                updateCountdown('🚀 开抢！');
                return;
            }
            const ts = Math.floor(rem2 / 1000);
            const hh = String(Math.floor(ts / 3600)).padStart(2, '0');
            const mm = String(Math.floor((ts % 3600) / 60)).padStart(2, '0');
            const ss = String(ts % 60).padStart(2, '0');
            updateCountdown(`⏰ ${hh}:${mm}:${ss}`, `🔄 页面将自动刷新保活，每 ${refreshIntervalSec} 秒一次`);
        }, 1000);

        // 定时刷新页面
        refreshTimer = setTimeout(() => {
            clearInterval(countdownInterval);
            // 在保存session（已在 runCountdownLoop 开头保存，但以防万一）
            saveSession({
                courses: courses,
                targetTime: targetTime,
                refreshInterval: refreshIntervalSec
            });
            addLog(`🔄 正在刷新页面...（${new Date().toLocaleTimeString()}）`);
            location.reload();
        }, actualDelay);
    }

    // ========================
    //  初始化：从 session 恢复
    // ========================

    function initFromSession(session) {
        // 自动模式恢复
        createPanel(buildRunningPanelHTML());

        addLog(`📄 恢复自动模式 — 目标: ${session.courses.join(', ')}`);
        addLog(`⏰ 目标时间: ${new Date(session.targetTime).toLocaleTimeString()}`);

        // 挂载取消按钮
        const cancelBtn = document.getElementById('hstc-cancel-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                stopRefreshCycle();
                status.stopped = true;
                if (status.timer) clearTimeout(status.timer);
                addLog('⏹️ 已取消自动模式，刷新停止');
                updateCountdown('⏹️ 已取消');
                cancelBtn.textContent = '✅ 已取消';
                cancelBtn.disabled = true;
                cancelBtn.style.background = '#999';
            });
        }

        // 启动倒计时 + 刷新循环
        runCountdownLoop(session.courses, session.targetTime, session.refreshInterval || DEFAULT_REFRESH_INTERVAL);
    }

    // ========================
    //  主初始化
    // ========================

    function initInputPanel() {
        const panel = createPanel(buildInputPanelHTML());
        if (!panel) return;
        addLog('📄 页面已加载，等待设置...');

        // 默认设置今天 14:00
        const hourSel = document.getElementById('hstc-hour');
        const minSel = document.getElementById('hstc-minute');
        if (hourSel) hourSel.value = '14';
        if (minSel) minSel.value = '0';

        // --- 「启动自动模式」按钮 ---
        document.getElementById('hstc-action-btn').addEventListener('click', function() {
            if (status.started && !status.done) return;

            const input = document.getElementById('hstc-course-input');
            const raw = input ? input.value.trim() : '';
            const courses = raw.split('\n').map(s => s.trim()).filter(s => s);
            if (courses.length === 0) {
                addLog('⚠️ 请先输入至少一个课程名称');
                return;
            }

            const hour = parseInt(document.getElementById('hstc-hour').value);
            const minute = parseInt(document.getElementById('hstc-minute').value);
            const autoRefresh = document.getElementById('hstc-auto-refresh').checked;
            const refreshInterval = parseInt(
                document.getElementById('hstc-refresh-interval').value
            ) || DEFAULT_REFRESH_INTERVAL;

            // 构建目标时间（今天）
            const targetTime = new Date();
            targetTime.setHours(hour, minute, 0, 0);

            const now = Date.now();
            if (targetTime.getTime() <= now) {
                addLog('⚠️ 设置的时间已过，将立即开抢！');
                clearSession();
                startGrabbing(courses);
                return;
            }

            addLog(`🎯 目标: ${courses.join(', ')}`);
            addLog(`⏰ 开抢时间: ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00`);
            addLog(`🔄 自动刷新: ${autoRefresh ? '是 (' + refreshInterval + '秒/次)' : '否'}`);

            if (autoRefresh) {
                // 切换到运行中面板
                this.textContent = '⏳ 等待开抢...';
                this.disabled = true;

                // 启动自动模式
                startAutoRefreshCycle(courses, targetTime.getTime(), refreshInterval);
            } else {
                // 不开刷新，直接开机倒计时+手动等待
                addLog('⚠️ 未开启自动刷新，请保持页面不要关闭');
                this.textContent = '⏳ 等待开抢...';
                this.disabled = true;
                startAutoRefreshCycle(courses, targetTime.getTime(), 86400); // 间隔设很大=不刷新
            }
        });

        // --- 「立即开抢（手动）」按钮 ---
        document.getElementById('hstc-manual-start').addEventListener('click', function() {
            // 情况1：正在运行 → 停止
            if (status.started && !status.done) {
                status.stopped = true;
                if (status.timer) { clearTimeout(status.timer); status.timer = null; }
                status.started = false;
                status.courses = []; status.clicked = []; status.confirmed = [];
                resetUI();
                this.textContent = '⚡ 立即开抢（手动）';
                this.style.background = '#e67e22';
                // 恢复自动模式按钮
                const actionBtn = document.getElementById('hstc-action-btn');
                if (actionBtn) { actionBtn.textContent = '🚀 启动自动模式'; actionBtn.disabled = false; }
                addLog('⏹️ 已停止，修改课程后可重新开抢');
                updateCountdown('⏹️ 已停止，可修改后重试');
                return;
            }

            // 情况2：已完成或未开始 → 重置并开抢
            if (status.done) {
                status.done = false; status.started = false; status.stopped = false;
                status.courses = []; status.clicked = []; status.confirmed = [];
                resetUI();
                this.textContent = '🚀 立即开抢（手动）';
                this.style.background = '#238FBF';
            }

            // 开始抢课
            const input = document.getElementById('hstc-course-input');
            const raw = input ? input.value.trim() : '';
            const courses = raw.split('\n').map(s => s.trim()).filter(s => s);
            if (courses.length === 0) {
                addLog('⚠️ 请先输入至少一个课程名称');
                return;
            }
            this.textContent = '⏹ 停止';
            this.style.background = '#e74c3c';
            addLog('👆 用户手动触发抢课！');
            updateCountdown('🚀 抢课中...');
            clearSession();
            startGrabbing(courses);
        });
    }

    function init() {
        // 检查是否在自动刷新模式（从 localStorage 恢复）
        const session = loadSession();
        if (session && session.targetTime && session.targetTime > Date.now()) {
            initFromSession(session);
        } else {
            if (session) clearSession(); // session 过期清除
            setTimeout(initInputPanel, 1500);
        }
    }

    // 启动
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
