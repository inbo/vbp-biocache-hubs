const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(root, 'grails-app/views/occurrence/_map.gsp'), 'utf8');

function templateSection(start, end) {
    const startIndex = source.indexOf(start);
    const endIndex = source.indexOf(end, startIndex);
    assert(startIndex >= 0 && endIndex > startIndex, 'Template section must exist');
    return source.slice(startIndex, endIndex);
}

function gridResponse(counts) {
    const requests = [];
    let opacity = '0.8';
    let styles;
    let cleared = 0;
    const legends = [];
    const features = counts.map((count, index) => ({properties: {TAG: 'cell-' + index}}));
    const jquery = () => ({text: () => opacity});
    function deferred(promise) {
        return {
            then(fulfilled, rejected) { return deferred(promise.then(fulfilled, rejected)); },
            fail(callback) { promise.catch(callback); return this; }
        };
    }
    jquery.ajax = options => {
        let resolve;
        let reject;
        const promise = new Promise((fulfilled, rejected) => { resolve = fulfilled; reject = rejected; });
        requests.push({options, resolve, reject});
        return deferred(promise);
    };
    const cellBounds = {getWest: () => 2.9, getSouth: () => 49.9, getEast: () => 5.2, getNorth: () => 52.1};
    const context = {
        MAP_VAR: {
            utmGridRequestId: 0,
            map: {getBounds: () => ({getWest: () => 3, getSouth: () => 50, getEast: () => 5, getNorth: () => 52})},
            mappingUrl: 'https://example.org',
            query: '?q=*:*'
        },
        L: {geoJson: () => ({getBounds: () => cellBounds})},
        URLSearchParams,
        $: jquery,
        setUtmGridLegend(message) { legends.push(message); }
    };
    vm.createContext(context);
    vm.runInContext(templateSection('    function loadUtmGridDensity(', '    function addLegendItem('), context);
    const layer = {
        clearLayers() { cleared++; },
        addData() {},
        setStyle(style) { styles = features.map(style); },
        eachLayer() {}
    };
    context.loadUtmGridDensity(layer, {facet: 'cl10531', layer: 'test', maxFeatures: 2500});
    return {
        requests,
        context,
        legends,
        get cleared() { return cleared; },
        async geometry(data = {type: 'FeatureCollection', features}) {
            requests[0].resolve(data);
            await new Promise(setImmediate);
        },
        async complete(currentOpacity) {
            opacity = currentOpacity;
            await this.geometry();
            requests[1].resolve({facetResults: [{
                fieldName: 'cl10531',
                fieldResult: counts.map((count, index) => ({label: 'cell-' + index, count}))
            }]});
            await new Promise(setImmediate);
            return styles;
        }
    };
}

test('UTM layers use the factory provided by the bundled Leaflet version', () => {
    const leaflet = fs.readFileSync(path.join(root, 'grails-app/assets/vendor/leaflet/leaflet-src.js'), 'utf8');
    assert.match(leaflet, /L\.geoJson = function/);
    assert.match(source, /layer = L\.geoJson\(null\)/);
    assert.doesNotMatch(source, /L\.geoJSON\(/);
});

test('popup auto-pan keeps the grid, but subsequent ordinary movement refreshes it', () => {
    const handlers = {};
    const hiddenGridLayer = {};
    let refreshes = 0;
    let selectedMode = 'utm-grid-1000';
    vm.runInNewContext(templateSection('        var popupAutoPan', "    $('<option>').val('utm-grid-1000')"), {
        MAP_VAR: {
            map: {on(event, handler) { handlers[event] = handler; }},
            currentLayers: [hiddenGridLayer]
        },
        UTM_GRID_MODES: {'utm-grid-1000': {}, 'utm-grid-5000': {}},
        $: () => ({val: () => selectedMode}),
        setUtmGridLegend() {},
        loadUtmGridDensity(layer) {
            assert.equal(layer, hiddenGridLayer);
            refreshes++;
        },
        addQueryLayer() { assert.fail('Movement must not rebuild or re-add hidden layers'); }
    });
    for (const mode of ['utm-grid-1000', 'utm-grid-5000']) {
        selectedMode = mode;
        handlers.autopanstart();
        const previousRefreshes = refreshes;
        handlers.moveend();
        assert.equal(refreshes, previousRefreshes);
        handlers.moveend();
        assert.equal(refreshes, previousRefreshes + 1);
    }
    selectedMode = 'grid';
    handlers.moveend();
    assert.equal(refreshes, 2);
});

test('response styling reads opacity changed while requests were pending', async () => {
    const styles = await gridResponse([100, 200]).complete('0.3');
    assert(styles.every(style => style.fillOpacity === 0.3));
});

test('minimum and maximum cell counts match the legend colour endpoints', async () => {
    const styles = await gridResponse([100, 150, 200]).complete('0.8');
    assert.equal(styles[0].fillColor, '#fff7bc');
    assert.equal(styles[1].fillColor, '#ec7014');
    assert.equal(styles[2].fillColor, '#8c2d04');
});

test('equal cell counts produce a defined uniform colour', async () => {
    const styles = await gridResponse([100, 100]).complete('0.8');
    assert(styles.every(style => style.fillColor === '#8c2d04'));
});

test('a single populated cell produces a defined colour', async () => {
    const styles = await gridResponse([100]).complete('0.8');
    assert.equal(styles[0].fillColor, '#8c2d04');
});

test('count queries wait for geometry and cover the full bounds of edge cells', async () => {
    const response = gridResponse([100]);
    assert.equal(response.requests.length, 1);
    assert.equal(response.requests[0].options.data.request, 'GetFeature');
    await response.geometry();
    assert.equal(response.requests.length, 2);
    const query = new URL(response.requests[1].options.url).searchParams;
    assert.deepEqual(query.getAll('fq'), [
        'decimalLatitude:[49.9 TO 52.1]',
        'decimalLongitude:[2.9 TO 5.2]'
    ]);
});

test('empty geometry clears previous cells without requesting counts', async () => {
    const response = gridResponse([]);
    await response.geometry();
    assert.equal(response.cleared, 1);
    assert.equal(response.requests.length, 1);
    assert.match(response.legends[0], /No records/);
});

test('oversized geometry clears previous cells without requesting counts', async () => {
    const response = gridResponse([100]);
    await response.geometry({features: [{properties: {TAG: 'cell-0'}}], totalFeatures: 2501});
    assert.equal(response.cleared, 1);
    assert.equal(response.requests.length, 1);
    assert.match(response.legends[0], /Zoom in/);
});

test('stale geometry does not start a count request or change the legend', async () => {
    const response = gridResponse([100]);
    response.context.MAP_VAR.utmGridRequestId++;
    await response.geometry();
    assert.equal(response.requests.length, 1);
    assert.equal(response.legends.length, 0);
});

test('count request failures display the grid error', async () => {
    const response = gridResponse([100]);
    await response.geometry();
    response.requests[1].reject(new Error('Count service unavailable'));
    await new Promise(setImmediate);
    assert.match(response.legends[0], /Unable to load/);
});