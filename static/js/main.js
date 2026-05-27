// Global State
let sigunguData = [];
let rawTransactions = [];
let scatterChart = null;
let trendChart = null;
let kakaoMap = null;
let mapMarkers = [];
let activeOverlay = null;
let geocoder = null;
let groupedData = {};

// DOM Elements
const selectSido = document.getElementById("select-sido");
const selectGugun = document.getElementById("select-gugun");
const inputMonth = document.getElementById("input-month");
const btnSearch = document.getElementById("btn-search");

const welcomeState = document.getElementById("welcome-state");
const loadingState = document.getElementById("loading-state");
const errorState = document.getElementById("error-state");
const errorTitle = document.getElementById("error-title");
const errorMessage = document.getElementById("error-message");
const dashboardContent = document.getElementById("dashboard-content");

// Tab Elements
const viewTabs = document.getElementById("view-tabs");
const tabButtons = document.querySelectorAll(".tab-btn");
const tabContents = document.querySelectorAll(".tab-content");

// Stats Elements
const statTotalCount = document.getElementById("stat-total-count");
const statAvgPrice = document.getElementById("stat-avg-price");
const statMaxPrice = document.getElementById("stat-max-price");
const statMaxApt = document.getElementById("stat-max-apt");
const statMinPrice = document.getElementById("stat-min-price");
const statMinApt = document.getElementById("stat-min-apt");

// Table & Search
const tableBody = document.getElementById("transaction-table-body");
const tableResultsCount = document.getElementById("table-results-count");
const inputSearchApt = document.getElementById("input-search-apt");

// Initialize application on load
window.addEventListener("DOMContentLoaded", () => {
    // Set default month to previous month (since current month might not have many transactions uploaded yet)
    const today = new Date();
    let year = today.getFullYear();
    let month = today.getMonth(); // getMonth() returns 0-11, which represents previous month in 1-12
    if (month === 0) {
        month = 12;
        year -= 1;
    }
    const paddedMonth = String(month).padStart(2, '0');
    inputMonth.value = `${year}-${paddedMonth}`;

    loadSigunguCodes();
    setupEventListeners();
    initMap();
});

// Setup Event Listeners
function setupEventListeners() {
    selectSido.addEventListener("change", handleSidoChange);
    btnSearch.addEventListener("click", fetchTransactions);
    inputSearchApt.addEventListener("input", handleSearchInput);
    
    // Tab buttons event listeners
    tabButtons.forEach(btn => {
        btn.addEventListener("click", handleTabChange);
    });
}

// Fetch and load sigungu codes from backend
async function loadSigunguCodes() {
    try {
        const response = await fetch("/api/sigungu");
        if (!response.ok) throw new Error("지역 데이터 로드 실패");
        sigunguData = await response.json();
        
        // Populate Sido
        sigunguData.forEach(item => {
            const option = document.createElement("option");
            option.value = item.code;
            option.textContent = item.sido;
            selectSido.appendChild(option);
        });
    } catch (err) {
        console.error("Error loading regions:", err);
        showError("서버 에러", "전국 행정구역 코드를 불러오는 데 실패했습니다. 서버가 정상적으로 동작 중인지 확인해 주세요.");
    }
}

// Sido change handler -> update Gugun dropdown
function handleSidoChange() {
    const selectedSidoCode = selectSido.value;
    
    // Clear gugun options
    selectGugun.innerHTML = '<option value="">시군구 선택</option>';
    
    if (!selectedSidoCode) {
        selectGugun.disabled = true;
        return;
    }
    
    // Find matching sido
    const matchedSido = sigunguData.find(item => item.code === selectedSidoCode);
    if (matchedSido && matchedSido.gugun) {
        matchedSido.gugun.forEach(gugun => {
            const option = document.createElement("option");
            option.value = gugun.code;
            option.textContent = gugun.name;
            selectGugun.appendChild(option);
        });
        selectGugun.disabled = false;
    } else {
        selectGugun.disabled = true;
    }
}

// Fetch transactions from API
async function fetchTransactions() {
    const lawdCd = selectGugun.value;
    const dealYmd = inputMonth.value;
    
    if (!lawdCd) {
        alert("시군구를 선택해 주세요.");
        return;
    }
    
    if (!dealYmd) {
        alert("거래연월을 지정해 주세요.");
        return;
    }
    
    // Switch state to Loading
    welcomeState.classList.add("hidden");
    dashboardContent.classList.add("hidden");
    viewTabs.classList.add("hidden");
    errorState.classList.add("hidden");
    loadingState.classList.remove("hidden");
    
    try {
        const response = await fetch(`/api/transactions?lawd_cd=${lawdCd}&deal_ymd=${dealYmd}`);
        const result = await response.json();
        
        if (!response.ok || result.error) {
            throw new Error(result.error || "실거래 데이터를 불러오는 데 실패했습니다.");
        }
        
        rawTransactions = result.items || [];
        
        if (rawTransactions.length === 0) {
            showError("데이터 없음", `${inputMonth.value}에 해당 지역의 아파트 실거래 데이터가 존재하지 않거나, 아직 등록되지 않았습니다.`);
            return;
        }
        
        // Render Dashboard
        renderDashboard(result);
        
    } catch (err) {
        console.error(err);
        showError("데이터 조회 오류", err.message || "공공데이터 API 통신 중 알 수 없는 에러가 발생했습니다.");
    }
}

// Render entire dashboard (stats, charts, table)
function renderDashboard(data) {
    loadingState.classList.add("hidden");
    dashboardContent.classList.remove("hidden");
    viewTabs.classList.remove("hidden");
    
    const stats = data.stats;
    
    // 1. Render Stats
    statTotalCount.textContent = `${stats.total_count.toLocaleString()}건`;
    statAvgPrice.textContent = stats.avg_price_formatted;
    
    statMaxPrice.textContent = stats.max_price_formatted;
    statMaxApt.textContent = `${stats.max_dong} ${stats.max_apt}`;
    statMaxApt.title = `${stats.max_dong} ${stats.max_apt}`;
    
    statMinPrice.textContent = stats.min_price_formatted;
    statMinApt.textContent = `${stats.min_dong} ${stats.min_apt}`;
    statMinApt.title = `${stats.min_dong} ${stats.min_apt}`;
    
    // 2. Render Charts
    renderScatterChart(rawTransactions);
    renderTrendChart(rawTransactions);
    
    // 3. Render Map
    renderMap(rawTransactions);
    
    // 4. Render Table
    inputSearchApt.value = ""; // reset search filter
    renderTableRows(rawTransactions);
}

// Render Table Rows
function renderTableRows(items) {
    tableBody.innerHTML = "";
    tableResultsCount.textContent = `${items.length.toLocaleString()}건의 결과`;
    
    if (items.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 3rem;">조건에 맞는 거래 데이터가 없습니다.</td></tr>`;
        return;
    }
    
    items.forEach(item => {
        const tr = document.createElement("tr");
        tr.style.cursor = "pointer";
        
        // Build age badge class
        let ageBadgeClass = "badge-age";
        if (item.building_age <= 5) {
            ageBadgeClass += " new-building";
        }
        
        // Format Date nicely: YYYY-MM-DD -> MM.DD
        let formattedDate = item.deal_date;
        if (formattedDate.includes("-")) {
            const parts = formattedDate.split("-");
            if (parts.length === 3) {
                formattedDate = `${parts[1]}.${parts[2]}`;
            }
        }
        
        tr.innerHTML = `
            <td>${formattedDate}</td>
            <td>${item.dong}</td>
            <td style="font-weight: 500;">${item.apt_name}</td>
            <td class="price">${item.price_formatted}</td>
            <td>
                ${item.area_m2}㎡
                <span class="badge-pyeong">~${item.area_pyeong}평</span>
            </td>
            <td>${item.floor}층</td>
            <td>
                ${item.build_year}년
                <span class="${ageBadgeClass}">${item.building_age}년차</span>
            </td>
        `;
        
        // Table row click event -> navigate map to this apartment
        tr.addEventListener("click", () => {
            const key = `${item.dong} ${item.apt_name}`;
            const matchedGroup = groupedData[key];
            if (matchedGroup && matchedGroup.latLng) {
                const mapTabBtn = document.querySelector('.tab-btn[data-tab="map"]');
                if (mapTabBtn) {
                    mapTabBtn.click();
                }
                setTimeout(() => {
                    showOverlayForGroup(matchedGroup, matchedGroup.latLng);
                }, 200);
            }
        });
        
        tableBody.appendChild(tr);
    });
}

// Handle Client Side Search
function handleSearchInput() {
    const query = inputSearchApt.value.toLowerCase().trim();
    if (!query) {
        renderTableRows(rawTransactions);
        return;
    }
    
    const filtered = rawTransactions.filter(item => 
        item.apt_name.toLowerCase().includes(query) || 
        item.dong.toLowerCase().includes(query)
    );
    renderTableRows(filtered);
}

// Show Error Container
function showError(title, msg) {
    loadingState.classList.add("hidden");
    welcomeState.classList.add("hidden");
    dashboardContent.classList.add("hidden");
    viewTabs.classList.add("hidden");
    
    errorTitle.textContent = title;
    errorMessage.textContent = msg;
    errorState.classList.remove("hidden");
}

// ---------------- TAB AND MAP FUNCTIONS ----------------

// Tab change handler
function handleTabChange(e) {
    const targetTab = e.currentTarget.getAttribute("data-tab");
    
    tabButtons.forEach(btn => btn.classList.remove("active"));
    e.currentTarget.classList.add("active");
    
    tabContents.forEach(content => {
        content.classList.remove("active-content");
        if (content.id === `tab-${targetTab}`) {
            content.classList.add("active-content");
        }
    });
    
    if (targetTab === "map" && kakaoMap) {
        setTimeout(() => {
            kakaoMap.relayout();
            if (mapMarkers.length > 0) {
                fitMapToBounds();
            }
        }, 100);
    }
}

// Initialize Kakao Map
function initMap() {
    if (typeof kakao === "undefined" || !kakao.maps) {
        console.warn("Kakao Maps SDK not loaded. Check your kakao_key in .env file.");
        const mapContainer = document.getElementById("map-container");
        if (mapContainer) mapContainer.classList.add("hidden");
        const errorMsg = document.getElementById("map-error-msg");
        if (errorMsg) errorMsg.classList.remove("hidden");
        return false;
    }
    
    try {
        const container = document.getElementById('map-container');
        const options = {
            center: new kakao.maps.LatLng(37.566826, 126.9786567), // Seoul default
            level: 5
        };
        
        kakaoMap = new kakao.maps.Map(container, options);
        geocoder = new kakao.maps.services.Geocoder();
        
        const zoomControl = new kakao.maps.ZoomControl();
        kakaoMap.addControl(zoomControl, kakao.maps.ControlPosition.RIGHT);
        return true;
    } catch (e) {
        console.error("Failed to initialize Kakao Map:", e);
        return false;
    }
}

// Geocoding wrapper with cache to avoid duplicate calls for the same address
const geocodeCache = {};

function geocodeAddress(address) {
    if (geocodeCache[address]) {
        return Promise.resolve(geocodeCache[address]);
    }
    return new Promise((resolve) => {
        geocoder.addressSearch(address, (result, status) => {
            if (status === kakao.maps.services.Status.OK) {
                const coords = {
                    lat: parseFloat(result[0].y),
                    lng: parseFloat(result[0].x)
                };
                geocodeCache[address] = coords;
                resolve(coords);
            } else {
                resolve(null);
            }
        });
    });
}

// Group transactions and draw markers on Kakao Map
async function renderMap(items) {
    if (!kakaoMap || !geocoder) {
        return;
    }
    
    clearMap();
    
    if (items.length === 0) return;
    
    const sidoName = selectSido.options[selectSido.selectedIndex].text;
    const gugunName = selectGugun.options[selectGugun.selectedIndex].text;
    
    // Group transactions by apartment
    const groups = {};
    items.forEach(tx => {
        const key = `${tx.dong} ${tx.apt_name}`;
        if (!groups[key]) {
            groups[key] = {
                apt_name: tx.apt_name,
                dong: tx.dong,
                fullAddress: `${sidoName} ${gugunName} ${tx.dong} ${tx.apt_name}`,
                backupAddress: `${sidoName} ${gugunName} ${tx.dong}`,
                deals: [],
                totalPrice: 0
            };
        }
        groups[key].deals.push(tx);
        groups[key].totalPrice += tx.price_raw;
    });
    
    groupedData = groups;
    const groupList = Object.values(groups);
    
    // Geocode in parallel
    const markerPromises = groupList.map(async (group) => {
        let coords = await geocodeAddress(group.fullAddress);
        if (!coords) {
            coords = await geocodeAddress(group.backupAddress);
        }
        if (coords) {
            return { group, coords };
        }
        return null;
    });
    
    const geocodedResults = (await Promise.all(markerPromises)).filter(r => r !== null);
    const bounds = new kakao.maps.LatLngBounds();
    
    geocodedResults.forEach(res => {
        const latLng = new kakao.maps.LatLng(res.coords.lat, res.coords.lng);
        bounds.extend(latLng);
        
        const dealCount = res.group.deals.length;
        const avgPriceRaw = Math.round(res.group.totalPrice / dealCount);
        const avgPriceFormatted = formatPriceKorean(avgPriceRaw);
        
        // Custom Overlay for Marker (clickable label)
        const markerContent = document.createElement('div');
        markerContent.className = 'custom-marker-label';
        markerContent.innerHTML = `${res.group.apt_name.substring(0, 5)}..<br>${avgPriceFormatted}`;
        markerContent.style.cursor = 'pointer';
        
        const customMarker = new kakao.maps.CustomOverlay({
            position: latLng,
            content: markerContent,
            yAnchor: 1
        });
        
        customMarker.setMap(kakaoMap);
        
        markerContent.addEventListener('click', () => {
            showOverlayForGroup(res.group, latLng);
        });
        
        mapMarkers.push(customMarker);
        res.group.latLng = latLng;
    });
    
    // Adjust bounds
    if (geocodedResults.length > 0) {
        // Only set bounds when tab is map, or defer until map tab is open
        const activeTab = document.querySelector('.tab-btn.active');
        if (activeTab && activeTab.getAttribute('data-tab') === 'map') {
            setTimeout(() => {
                kakaoMap.setBounds(bounds);
            }, 100);
        }
    }
}

function clearMap() {
    if (activeOverlay) {
        activeOverlay.setMap(null);
        activeOverlay = null;
    }
    mapMarkers.forEach(marker => {
        marker.setMap(null);
    });
    mapMarkers = [];
}

function fitMapToBounds() {
    if (mapMarkers.length === 0 || !kakaoMap) return;
    const bounds = new kakao.maps.LatLngBounds();
    mapMarkers.forEach(marker => {
        bounds.extend(marker.getPosition());
    });
    kakaoMap.setBounds(bounds);
}

function formatPriceKorean(priceRaw) {
    if (priceRaw >= 10000) {
        const uk = Math.floor(priceRaw / 10000);
        const man = priceRaw % 10000;
        if (man > 0) {
            return `${uk}억 ${man.toLocaleString()}만`;
        } else {
            return `${uk}억`;
        }
    } else {
        return `${priceRaw.toLocaleString()}만`;
    }
}

function showOverlayForGroup(group, latLng) {
    if (activeOverlay) {
        activeOverlay.setMap(null);
    }
    
    const dealCount = group.deals.length;
    const avgPriceRaw = Math.round(group.totalPrice / dealCount);
    const avgPriceFormatted = formatPriceKorean(avgPriceRaw);
    
    group.deals.sort((a, b) => new Date(b.deal_date) - new Date(a.deal_date));
    
    const overlayElement = document.createElement('div');
    overlayElement.className = 'kakao-custom-overlay';
    
    const header = document.createElement('div');
    header.className = 'overlay-header';
    header.innerHTML = `
        <span class="overlay-title">${group.apt_name}</span>
        <button class="overlay-close">&times;</button>
    `;
    overlayElement.appendChild(header);
    
    header.querySelector('.overlay-close').addEventListener('click', () => {
        activeOverlay.setMap(null);
        activeOverlay = null;
    });
    
    const body = document.createElement('div');
    body.className = 'overlay-body';
    body.innerHTML = `
        <div class="overlay-stat">
            <span class="overlay-stat-label">평균 거래가</span>
            <span class="overlay-stat-value">${avgPriceFormatted} 원</span>
        </div>
        <div class="overlay-stat">
            <span class="overlay-stat-label">해당월 거래건수</span>
            <span class="overlay-stat-value">${dealCount}건</span>
        </div>
        <div class="overlay-deal-list"></div>
    `;
    
    const dealListContainer = body.querySelector('.overlay-deal-list');
    
    group.deals.slice(0, 5).forEach(deal => {
        const item = document.createElement('div');
        item.className = 'overlay-deal-item';
        
        let formattedDate = deal.deal_date;
        if (formattedDate.includes("-")) {
            const parts = formattedDate.split("-");
            if (parts.length === 3) formattedDate = `${parts[1]}.${parts[2]}`;
        }
        
        item.innerHTML = `
            <span class="overlay-deal-price">${deal.price_formatted} (${deal.floor}층)</span>
            <span class="overlay-deal-area">${deal.area_pyeong}평 | ${formattedDate}</span>
        `;
        dealListContainer.appendChild(item);
    });
    
    if (dealCount > 5) {
        const moreDiv = document.createElement('div');
        moreDiv.style.fontSize = '0.7rem';
        moreDiv.style.color = 'var(--text-muted)';
        moreDiv.style.textAlign = 'center';
        moreDiv.style.marginTop = '0.2rem';
        moreDiv.textContent = `외 ${dealCount - 5}건의 거래가 더 있습니다.`;
        dealListContainer.appendChild(moreDiv);
    }
    
    overlayElement.appendChild(body);
    
    activeOverlay = new kakao.maps.CustomOverlay({
        content: overlayElement,
        position: latLng,
        xAnchor: 0.5,
        yAnchor: 0
    });
    
    activeOverlay.setMap(kakaoMap);
    kakaoMap.panTo(latLng);
}

// ---------------- CHART RENDERING ----------------

// Chart.js Default styling tweaks for Dark Mode
const chartConfigDefaults = {
    color: '#94a3b8', // slate-400
    borderColor: 'rgba(255, 255, 255, 0.08)',
    gridColor: 'rgba(255, 255, 255, 0.05)',
    fontFamily: "'Inter', sans-serif"
};

// Render Scatter Chart: Price vs Area
function renderScatterChart(items) {
    const ctx = document.getElementById('chart-scatter').getContext('2d');
    
    if (scatterChart) {
        scatterChart.destroy();
    }
    
    // Prepare data
    const chartData = items.map(item => ({
        x: item.area_m2,
        y: item.price_raw / 10000, // Show in 억 원
        apt: item.apt_name,
        dong: item.dong,
        floor: item.floor,
        pyeong: item.area_pyeong,
        priceStr: item.price_formatted
    }));
    
    scatterChart = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: '아파트 거래 건',
                data: chartData,
                backgroundColor: 'rgba(6, 182, 212, 0.6)', // Cyan
                borderColor: '#06b6d4',
                borderWidth: 1,
                pointRadius: 6,
                pointHoverRadius: 8,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleColor: '#ffffff',
                    bodyColor: '#e2e8f0',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    padding: 12,
                    callbacks: {
                        label: function(context) {
                            const raw = context.raw;
                            return [
                                `단지명: ${raw.dong} ${raw.apt}`,
                                `거래가: ${raw.priceStr} (${raw.floor}층)`,
                                `전용면적: ${raw.x}㎡ (~${raw.pyeong}평)`
                            ];
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        color: chartConfigDefaults.gridColor
                    },
                    title: {
                        display: true,
                        text: '전용면적 (㎡)',
                        color: chartConfigDefaults.color,
                        font: {
                            family: chartConfigDefaults.fontFamily,
                            weight: '600'
                        }
                    },
                    ticks: {
                        color: chartConfigDefaults.color
                    }
                },
                y: {
                    grid: {
                        color: chartConfigDefaults.gridColor
                    },
                    title: {
                        display: true,
                        text: '거래가격 (억 원)',
                        color: chartConfigDefaults.color,
                        font: {
                            family: chartConfigDefaults.fontFamily,
                            weight: '600'
                        }
                    },
                    ticks: {
                        color: chartConfigDefaults.color
                    }
                }
            }
        }
    });
}

// Render Line Chart: Daily Volume and Prices
function renderTrendChart(items) {
    const ctx = document.getElementById('chart-line').getContext('2d');
    
    if (trendChart) {
        trendChart.destroy();
    }
    
    // Group transactions by day
    const dayGroups = {};
    items.forEach(item => {
        // Extract day from deal_date (YYYY-MM-DD)
        const dateParts = item.deal_date.split('-');
        if (dateParts.length === 3) {
            const day = parseInt(dateParts[2]);
            if (!dayGroups[day]) {
                dayGroups[day] = { count: 0, sum: 0 };
            }
            dayGroups[day].count += 1;
            dayGroups[day].sum += item.price_raw;
        }
    });
    
    // Generate full days (1 to 31)
    const labels = [];
    const avgPrices = [];
    const dealCounts = [];
    
    // Find unique days sorted
    const sortedDays = Object.keys(dayGroups).map(Number).sort((a, b) => a - b);
    
    sortedDays.forEach(day => {
        labels.push(`${day}일`);
        const group = dayGroups[day];
        avgPrices.push(Math.round(group.sum / group.count / 100) / 100); // 억 원 단위, 소수점 2자리
        dealCounts.push(group.count);
    });
    
    trendChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    type: 'bar',
                    label: '거래 건수',
                    data: dealCounts,
                    backgroundColor: 'rgba(139, 92, 246, 0.4)', // Purple
                    borderColor: 'rgba(139, 92, 246, 0.8)',
                    borderWidth: 1,
                    yAxisID: 'y-axis-count',
                    order: 2
                },
                {
                    type: 'line',
                    label: '평균 거래가 (억)',
                    data: avgPrices,
                    borderColor: '#06b6d4', // Cyan
                    backgroundColor: 'transparent',
                    borderWidth: 3,
                    tension: 0.3,
                    pointBackgroundColor: '#06b6d4',
                    pointHoverRadius: 6,
                    yAxisID: 'y-axis-price',
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: chartConfigDefaults.color,
                        boxWidth: 15
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleColor: '#ffffff',
                    bodyColor: '#e2e8f0',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    padding: 10
                }
            },
            scales: {
                x: {
                    grid: {
                        color: 'transparent'
                    },
                    ticks: {
                        color: chartConfigDefaults.color
                    }
                },
                'y-axis-price': {
                    type: 'linear',
                    position: 'left',
                    grid: {
                        color: chartConfigDefaults.gridColor
                    },
                    title: {
                        display: true,
                        text: '평균 가격 (억 원)',
                        color: chartConfigDefaults.color
                    },
                    ticks: {
                        color: chartConfigDefaults.color
                    }
                },
                'y-axis-count': {
                    type: 'linear',
                    position: 'right',
                    grid: {
                        drawOnChartArea: false // prevent overlay grids
                    },
                    title: {
                        display: true,
                        text: '거래량 (건)',
                        color: chartConfigDefaults.color
                    },
                    ticks: {
                        color: chartConfigDefaults.color,
                        stepSize: 1
                    }
                }
            }
        }
    });
}
