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
    let responseCallback;
    let opacity = '0.8';
    let styles;
    const features = counts.map((count, index) => ({properties: {TAG: 'cell-' + index}}));
    const jquery = () => ({text: () => opacity});
    jquery.ajax = () => ({});
    jquery.when = () => ({
        done(callback) {
            responseCallback = callback;
            return {fail() {}};
        }
    });
    const context = {
        MAP_VAR: {
            utmGridRequestId: 0,
            map: {getBounds: () => ({getWest: () => 3, getSouth: () => 50, getEast: () => 5, getNorth: () => 52})},
            mappingUrl: 'https://example.org',
            query: '?q=*:*'
        },
        URLSearchParams,
        $: jquery,
        setUtmGridLegend() {}
    };
    vm.createContext(context);
    vm.runInContext(templateSection('    function loadUtmGridDensity(', '    function addLegendItem('), context);
    const layer = {
        clearLayers() {},
        addData() {},
        setStyle(style) { styles = features.map(style); },
        eachLayer() {}
    };
    context.loadUtmGridDensity(layer, {facet: 'cl10531', layer: 'test', maxFeatures: 2500});
    return {
        complete(currentOpacity) {
            opacity = currentOpacity;
            responseCallback([{facetResults: [{
                fieldName: 'cl10531',
                fieldResult: counts.map((count, index) => ({label: 'cell-' + index, count}))
            }]}], [{features}]);
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
    let refreshes = 0;
    let selectedMode = 'utm-grid-1000';
    vm.runInNewContext(templateSection('        var popupAutoPan', "    $('<option>').val('utm-grid-1000')"), {
        MAP_VAR: {map: {on(event, handler) { handlers[event] = handler; }}},
        UTM_GRID_MODES: {'utm-grid-1000': {}, 'utm-grid-5000': {}},
        $: () => ({val: () => selectedMode}),
        addQueryLayer: () => refreshes++
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

test('response styling reads opacity changed while requests were pending', () => {
    const styles = gridResponse([100, 200]).complete('0.3');
    assert(styles.every(style => style.fillOpacity === 0.3));
});

test('minimum and maximum cell counts match the legend colour endpoints', () => {
    const styles = gridResponse([100, 150, 200]).complete('0.8');
    assert.equal(styles[0].fillColor, '#fff7bc');
    assert.equal(styles[1].fillColor, '#ec7014');
    assert.equal(styles[2].fillColor, '#8c2d04');
});

test('equal cell counts produce a defined uniform colour', () => {
    const styles = gridResponse([100, 100]).complete('0.8');
    assert(styles.every(style => style.fillColor === '#8c2d04'));
});

test('a single populated cell produces a defined colour', () => {
    const styles = gridResponse([100]).complete('0.8');
    assert.equal(styles[0].fillColor, '#8c2d04');
});