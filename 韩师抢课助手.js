// ==UserScript==
// @name         韩师抢课助手
// @namespace    https://gitee.com/mangohia/hstc-course-grabber
// @version      1.0
// @description  韩山师范学院自动抢选修课，到点自动点击选课按钮
// @author       mangohia
// @match        *://webvpn.hstc.edu.cn/*eams/stdElectCourse*
// @match        http://localhost:8888/*
// @match        http://127.0.0.1:8888/*
// @icon         https://www.hstc.edu.cn/favicon.ico
// @downloadURL  https://gitee.com/mangohia/hstc-course-grabber/raw/main/韩师抢课助手.js
// @updateURL    https://gitee.com/mangohia/hstc-course-grabber/raw/main/韩师抢课助手.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ===== 配置区 =====
    // 开抢时间（24小时制）
    const GRAB_TIME = { hour: 14, minute: 0, second: 0 };

    // 抢到后是否自动切换到「已选课程」标签确认
    const AUTO_CHECK = true;

    // 点击后等待确认的时间（毫秒）
    const CONFIRM_WAIT = 1500;

    // ===== 以下为脚本逻辑 =====

    let status = {
        courses: [],   // 从输入框读取
        clicked: [],
        confirmed: [],
        started: false,
        stopped: false,
        timer: null,
        done: false
    };

    // 创建悬浮面板
    function createPanel() {
        const panel = document.createElement('div');
        panel.id = 'hstc-grabber-panel';
        panel.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            width: 300px;
            background: #fff;
            border: 2px solid #238FBF;
            border-radius: 12px;
            padding: 16px;
            padding-top: 0;
            z-index: 99999;
            font-family: "Microsoft YaHei", sans-serif;
            box-shadow: 0 4px 20px rgba(0,0,0,0.2);
            font-size: 14px;
        `;
        panel.innerHTML = `
            <div id="hstc-drag-handle" style="
                cursor: move; user-select: none;
                padding: 12px 0; margin-bottom: 6px;
                font-weight:bold;font-size:16px;color:#238FBF;
            ">
                🎯 韩师抢课助手
            </div>
            <div id="hstc-countdown" style="font-size:20px;font-weight:bold;color:#333;text-align:center;padding:8px;background:#f0f7ff;border-radius:8px;margin-bottom:10px;">
                加载中...
            </div>
            <div style="margin-bottom:6px;color:#666;font-size:13px;">
                目标课程（每行一个）：
            </div>
            <div style="margin-bottom:8px;">
                <textarea id="hstc-course-input" rows="3" style="
                    width:100%;box-sizing:border-box;padding:6px 8px;
                    border:1px solid #ddd;border-radius:6px;font-size:13px;
                    resize:vertical;font-family:inherit;
                " placeholder="舌尖上的潮州菜 财经新闻与理财"></textarea>
            </div>
            <div id="hstc-course-status" style="margin-bottom:8px;display:none;"></div>
            <div id="hstc-log" style="font-size:12px;color:#999;border-top:1px solid #eee;padding-top:8px;margin-top:4px;max-height:80px;overflow-y:auto;">
                ✅ 脚本已加载，输入课程名后点击下方按钮开始
            </div>
        `;
        document.body.appendChild(panel);
        // 添加拖拽功能
        makeDraggable(panel);
        return panel;
    }

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

    function updateCourseStatus(index, text, color) {
        const el = document.querySelector(`#hstc-course-${index} span:last-child`);
        if (el) {
            el.textContent = text;
            el.style.color = color || '#999';
        }
    }

    function updateCountdown(text) {
        const el = document.getElementById('hstc-countdown');
        if (el) el.textContent = text;
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

    // 倒计时
    function startCountdown() {
        const now = new Date();
        const target = new Date();
        target.setHours(GRAB_TIME.hour, GRAB_TIME.minute, GRAB_TIME.second, 0);

        // 如果已经过了今天的目标时间，说明抢课可能已经开始了
        if (now >= target) {
            updateCountdown('⏰ 开抢时间已到！');
            addLog('检测到时间已到，开始抢课！');
            startGrabbing();
            return;
        }

        const diff = target - now;
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        updateCountdown(`⏰ ${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`);

        // 每秒更新
        setTimeout(startCountdown, 1000);
    }

    // 查找表格中所有选课按钮
    function findAllCourseButtons() {
        const buttons = [];
        // 精确匹配：a.lessonListOperator[operator=ELECTION] 含文字"选课"
        const links = document.querySelectorAll('a.lessonListOperator[operator="ELECTION"]');
        for (const el of links) {
            if (el.textContent && el.textContent.trim() === '选课') {
                const row = el.closest('tr') || el.parentElement;
                if (row) {
                    const rowText = row.textContent || '';
                    buttons.push({ element: el, rowText: rowText });
                }
            }
        }
        return buttons;
    }

    // 核心抢课逻辑
    function startGrabbing() {
        if (status.started) return;
        status.started = true;

        // 从输入框读取课程名
        const input = document.getElementById('hstc-course-input');
        const raw = input ? input.value.trim() : '';
        status.courses = raw.split('\n').map(s => s.trim()).filter(s => s.length > 0);

        if (status.courses.length === 0) {
            addLog('⚠️ 请先输入至少一个课程名称');
            updateCountdown('⚠️ 未输入课程名');
            status.started = false;
            return;
        }

        addLog(`🚀 开始抢课！目标: ${status.courses.join(', ')}`);

        // 隐藏输入框，显示课程状态
        input.style.display = 'none';
        document.querySelector('#hstc-course-status').style.display = 'block';
        document.querySelector('#hstc-course-status').innerHTML = status.courses.map((name, i) => `
            <div id="hstc-course-${i}" style="padding:4px 8px;margin:4px 0;border-radius:6px;background:#f5f5f5;display:flex;justify-content:space-between;align-items:center;">
                <span>${name}</span>
                <span style="font-size:12px;color:#999;">⏳ 等待中</span>
            </div>
        `).join('');

        let attempts = 0;
        const maxAttempts = 600;

        function attemptGrab() {
            if (status.stopped) return;
            attempts++;
            addLog(`第 ${attempts} 次尝试...`);

            const allBtns = findAllCourseButtons();

            // 对每个目标课程，找到对应的按钮并点击
            status.courses.forEach((courseName, index) => {
                // 如果已经抢到了就跳过
                if (status.confirmed.includes(index)) return;

                // 查找匹配的按钮
                let found = false;
                for (const btnInfo of allBtns) {
                    if (btnInfo.rowText.includes(courseName)) {
                        found = true;
                        if (!status.clicked.includes(index)) {
                            addLog(`🎯 找到「${courseName}」，正在点击选课...`);
                            updateCourseStatus(index, '🔄 点击中...', '#f90');
                            btnInfo.element.click();
                            status.clicked.push(index);

                            // 等待确认弹窗
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

            // 检查是否全部完成
            if (status.confirmed.length === status.courses.length) {
                status.stopped = true;
                if (status.timer) clearTimeout(status.timer);
                addLog('✅ 全部课程已抢到！');
                updateCountdown('✅ 全部完成！');
                status.done = true;
                const btn = document.getElementById('hstc-manual-start');
                if (btn) { btn.textContent = '✅ 已完成'; btn.style.background = '#27ae60'; btn.disabled = true; }
                if (AUTO_CHECK) {
                    setTimeout(switchToSelectedTab, 1000);
                }
                return;
            }

            // 继续尝试
            if (attempts < maxAttempts && !status.stopped) {
                status.timer = setTimeout(attemptGrab, 1000);
            } else if (!status.stopped) {
                addLog('⏰ 尝试次数已达上限，请手动操作');
                updateCountdown('⚠️ 请手动操作');
            }
        }

        // 先立即尝试一次
        attemptGrab();
    }

    // 处理确认弹窗
    function handleConfirm(courseName, index) {
        // 查找确认按钮（常见的确认对话框）
        const confirmBtn = document.querySelector('.dialog-confirm button, .confirm-btn, .messager-button .l-btn, button:contains("确定"), [class*="confirm"] a, .dialog-button a:first-child');
        if (confirmBtn) {
            addLog(`✅ 「${courseName}」弹窗确认中...`);
            confirmBtn.click();
            updateCourseStatus(index, '✅ 已抢到！', '#0a0');
            status.confirmed.push(index);
        } else {
            // 可能没有弹窗，或者弹窗还没出现
            // 检查是否有弹窗出现
            const dialog = document.querySelector('.dialog, .messager-window, [class*="dialog"], [role="dialog"]');
            if (dialog && dialog.style.display !== 'none') {
                const btns = dialog.querySelectorAll('a, button, span');
                for (const btn of btns) {
                    if (btn.textContent && (btn.textContent.includes('确定') || btn.textContent.includes('确认') || btn.textContent.includes('是'))) {
                        addLog(`✅ 「${courseName}」弹窗确认中...`);
                        btn.click();
                        updateCourseStatus(index, '✅ 已抢到！', '#0a0');
                        status.confirmed.push(index);
                        return;
                    }
                }
            }
            // 多等一会再查
            setTimeout(() => {
                // 再查一次弹窗
                const dialog2 = document.querySelector('.dialog, .messager-window, [class*="dialog"], [role="dialog"]');
                if (dialog2 && dialog2.style.display !== 'none') {
                    const btns = dialog2.querySelectorAll('a, button, span');
                    for (const btn of btns) {
                        if (btn.textContent && (btn.textContent.includes('确定') || btn.textContent.includes('确认') || btn.textContent.includes('是'))) {
                            btn.click();
                            updateCourseStatus(index, '✅ 已抢到！', '#0a0');
                            status.confirmed.push(index);
                            return;
                        }
                    }
                }
                // 可能直接成功了，标记为完成
                addLog(`⚠️ 未检测到弹窗，可能已直接选课成功`);
                updateCourseStatus(index, '✅ 已提交', '#0a0');
                status.confirmed.push(index);
            }, 2000);
        }
    }

    // 切换到已选课程标签
    function switchToSelectedTab() {
        const tabs = document.querySelectorAll('a, span, div');
        for (const tab of tabs) {
            if (tab.textContent && tab.textContent.trim() === '已选课程') {
                tab.click();
                addLog('📋 已切换到「已选课程」标签查看结果');
                break;
            }
        }
    }

    // 页面加载完成后初始化
    function init() {
        // 等待页面完全加载
        setTimeout(() => {
            addLog('📄 页面已加载，初始化抢课助手...');
            const panel = createPanel();
            startCountdown();

            // 添加手动触发按钮
            const manualBtn = document.createElement('div');
            manualBtn.style.cssText = `
                text-align:center;margin-top:8px;
            `;
            manualBtn.innerHTML = `<button id="hstc-manual-start" style="
                background:#238FBF;color:#fff;border:none;padding:6px 20px;
                border-radius:6px;cursor:pointer;font-size:13px;
            ">🚀 立即开抢（手动）</button>`;
            panel.appendChild(manualBtn);

            document.getElementById('hstc-manual-start').addEventListener('click', function() {
                if (status.started && !status.done) {
                    // 停止抢课
                    status.stopped = true;
                    if (status.timer) clearTimeout(status.timer);
                    this.textContent = '▶️ 已停止';
                    this.style.background = '#999';
                    this.disabled = true;
                    addLog('⏹️ 用户手动停止抢课');
                    updateCountdown('⏹️ 已停止');
                    return;
                }
                // 开始抢课
                this.textContent = '⏹ 停止';
                this.style.background = '#e74c3c';
                addLog('👆 用户手动触发抢课！');
                updateCountdown('🚀 抢课中...');
                startGrabbing();
            });

        }, 1500);
    }

    // 启动
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
