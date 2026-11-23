
/*
 * Copyright (C) 2014 Atlas of Living Australia
 * All Rights Reserved.
 *
 * The contents of this file are subject to the Mozilla Public
 * License Version 1.1 (the "License"); you may not use this file
 * except in compliance with the License. You may obtain a copy of
 * the License at http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS
 * IS" basis, WITHOUT WARRANTY OF ANY KIND, either express or
 * implied. See the License for the specific language governing
 * rights and limitations under the License.
 */

/*
 * // require jquery
//= require jquery_i18n.js
//= require urlParams.js
//= require leaflet/leaflet.js
//= require maplibre-gl.js
//= require leaflet-maplibre-gl.js
//= require leaflet-plugins/layer/tile/Google.js
//= require leaflet-plugins/spin/spin.min.js
//= require leaflet-plugins/spin/leaflet.spin.js
//= require leaflet-plugins/EasyButton/easy-button.js
//= require magellan.js
//= require jquery.qtip.min.js
//= require map.common.js
//= require_self
 */

const SPECIES_GROUPS_TAB_ID = "speciesGroupsTab";
const SPECIES_LISTS_TAB_ID = "speciesListsTab";
if (typeof window !== 'undefined' && window.L) {
    window.L_mainMap = window.L;
}


var geocoder, marker, circle, markerInfowindow, lastInfoWindow, taxon, taxonGuid, alaWmsLayer, radius;
var points = [], infoWindows = [], speciesGroup = "ALL_SPECIES"; speciesListDrUid = "";
var coordinatePrecision = 4; // roughly 11m at equator || 5 = 1.1 m at equator
var zoomForRadius = {
    250: 16,
    500: 15,
    1000: 14,
    5000: 12,
    10000: 11
};
var radiusForZoom = {
    11: 10,
    12: 5,
    14: 1,
    15: 0.5,
    16: 0.25
};

/**
 * Document onLoad event using JQuery
 */
$(document).ready(function() {
    if (typeof BC_CONF != 'undefined' && BC_CONF.hasOwnProperty('contextPath')) {
        jQuery.i18n.properties({
            name: 'messages',
            path: BC_CONF.contextPath + '/messages/i18n/',
            mode: 'map',
            async: true,
            cache: true,
            language: BC_CONF.locale // default is to use browser specified locale
        });
    }

    // jQuery.i18n.properties is required now, wait a bit
    setTimeout(function () {
        init()
    }, 50)
}); // end onLoad event

function init() {
    // check for i18n
    var i = 0;
    $.each(jQuery.i18n.map, function() { i++ });
    if (i < 100) {  // wait for at least 100 elements in this map
        // wait longer for i18n
        setTimeout(function () {
            init()
        }, 50)
        return
    }

    leafletI18n();

    // initialise Google Geocoder (the Maps API is lazy loaded since #667, so wait for it)
    initGeocoder();

    // Catch page events...

    // Register events for the species_group column
    $('#taxa-level-0').on("mouseover mouseout", "tbody tr",  function() {
        // mouse hover on groups
        if ( event.type === "mouseover" ) {
            $(this).addClass('hoverRow');
        } else {
            $(this).removeClass('hoverRow');
        }
    }).on("click", "tbody tr", function(e) {
        // catch the link on the taxon groups table
        e.preventDefault(); // ignore the href text - used for data
        groupClicked(this);
    });

    // Register events for the species_list column
    $('#taxa-level-0-sl').on("mouseover mouseout", "tbody tr",  function() {
        // mouse hover on specieslists
        if ( event.type === "mouseover" ) {
            $(this).addClass('hoverRow');
        } else {
            $(this).removeClass('hoverRow');
        }
    }).on("click", "tbody tr", function(e) {
        // catch the link on the taxon groups table
        e.preventDefault(); // ignore the href text - used for data
        speciesListClicked(this);
    });

    // register click event on "Search" button"
    $('input#locationSearch').click(
        function(e) {
            e.preventDefault(); // ignore the href text - used for data
            geocodeAddress();
        }
    );

    // Register onChange event on radius drop-down - will re-submit form
    $('select#radius').change(
        function(e) {
            MAP_VAR.radius = parseFloat($(this).val());
            radius = MAP_VAR.radius * 1000;
            circle.setRadius(radius);
            MAP_VAR.zoom = zoomForRadius[radius];
            MAP_VAR.map.setZoom((MAP_VAR.zoom) ? MAP_VAR.zoom : 12);
            MAP_VAR.layerControl.removeLayer(marker); // prevent duplicate controls
            loadGroups();
        }
    );

    // QTip tooltips
    $(".tooltips").qtip({
        style: {
            classes: 'ui-tooltip-rounded ui-tooltip-shadow'
        },
        position: {
            target: 'mouse',
            adjust: { x: 6, y: 14 }
        }
    });

    // Handle tab switching for button label
    $('a[data-toggle="tab"]').on('shown.bs.tab', function (e) {
        var targetTab = $(e.target).attr('href');
        if (targetTab === '#' + SPECIES_LISTS_TAB_ID) {
            if (!speciesListDrUid) {
                $("#recordsGroupText").text("all");
            }
        } else if (targetTab === '#' + SPECIES_GROUPS_TAB_ID) {
            if (speciesGroup === "ALL_SPECIES") {
                $("#recordsGroupText").text("all");
            } else {
                $("#recordsGroupText").text("selected");
            }
        }
    });

    // Handle back button and saved URLs

    var defaultParam = getUrlParam('default'); // see urlParams.js
    var encodedHash = getEncodedHash();

    if (defaultParam) {
        initialize();
    } else if (getUrlParam('lat') && getUrlParam('lon') && getUrlParam('radius')) {
        // triggered if user has clicked "return to search results" from download confirmation page
        // URL with have params: lat, lon, radius & fq
        // e.g. q=*:*&lat=-35.2509&lon=149.1638&radius=1&fq=spatiallyValid:true&fq=species_group:Insects
        var lat = getUrlParam('lat');
        var lon = getUrlParam('lon');
        var radiusInMetres = getUrlParam('radius') * 1000; // assume radius is in km (SOLR radius param)
        var radius = zoomForRadius[radiusInMetres];
        var species_group;
        var fqs = getUrlParamAll('fq'); // always an array (possibly empty)

            fqs.forEach(function(fq) {
                var parts = fq.split(":"); // e.g. speciesGroup:Insects
                if (parts[0] === "species_group") {
                    species_group = parts[1];
                }
            });

        // strip params from URL
        window.history.replaceState(null, null, window.location.pathname);
        // update map state for provided coordinates, etc.
        bookmarkedSearch(lat, lon, radius, species_group);
    } else if (encodedHash) {
        // update map state from URL hash
        loadStateFromHash(encodedHash);
    } else {
        attemptGeolocation();
    }

    window.onhashchange = function() {
        // trigger state change (back button mostly - TODO check for duplicate function calls)
        loadStateFromHash(getEncodedHash());
    };

    // catch the link for "View all records"
    $('#viewAllRecords').on("click", function(e) {
        e.preventDefault();
        var params = "q=*:*&lat="+$('#latitude').val()+"&lon="+$('#longitude').val()+"&radius="+$('#radius').val()+"&fq=spatiallyValid:true";
        if (getActiveTabId() === SPECIES_GROUPS_TAB_ID) {
            if (speciesGroup !== "ALL_SPECIES") {
                params += "&fq=species_group:" + speciesGroup;
            }
        }
        if (getActiveTabId() === SPECIES_LISTS_TAB_ID) {
            params += "&fq=species_list_uid:" + speciesListDrUid;
        }
        document.location.href = MAP_VAR.contextPath +'/occurrences/search?' + params;
    });

    // catch the link for "Download"
    $('#downloadData').on("click", function(e) {
        e.preventDefault();
        var params = "?q=*:*&lat="+$('#latitude').val()+"&lon="+$('#longitude').val()+"&radius="+$('#radius').val()+"&fq=spatiallyValid:true";
        if (speciesGroup !== "ALL_SPECIES") {
            params += "&fq=species_group:" + speciesGroup;
        }
        var searchParams = encodeURIComponent(params);
        document.location.href = MAP_VAR.contextPath +'/download?searchParams=' + searchParams + "&targetUri=" + MAP_VAR.forwardURI;
    });


    // Tooltip for matched location
    $('#addressHelp').qtip({
        content: {
            title: {
                text: "About the matched address",
                button: "Close"
            },
            text: "<img src=\"" + MAP_VAR.imagesUrlPrefix + "/spinner.gif\" alt=\"\" class=\"no-rounding\"/>",
            ajax: {
                url: MAP_VAR.contextPath + "/proxy/wordpress", // TODO fix proxy
                data: {
                    page_id: 27726,
                    "content-only": 1
                },
                type: "get"
            }
        },
        position: {
            at: "bottom right",
            my: "top left"
        },
        style: {
            width: 450,
            tip: "topLeft",
            classes: 'ui-tooltip-light ui-tooltip-rounded ui-tooltip-shadow'
        },
        show: {
            effect: function(api) { $(this).slideDown(300, function(){ $(this).dequeue(); }); }
        },
        hide: {
            fixed: true,
            effect: function(api) { $(this).slideUp(300, function(){ $(this).dequeue(); }); },
            event: "unfocus"
        }
    }).bind('click', function(event){ event.preventDefault(); return false;});

    $("#left-col a").qtip({
        style: {
            classes: 'ui-tooltip-rounded ui-tooltip-shadow'
        },
        position: {
            target: 'mouse',
            adjust: {
                x: 10,
                y: 12
            }
        }
    });

    // qtip for easy-button
    $('.easy-button-button').qtip();

    // Catch enter key press on form
    $("#searchForm").bind("keypress", function(e) {
        if (e.keyCode === 13) {
            e.preventDefault();
            geocodeAddress();
        }
    });
}

// pointer fn
function initialize() {
    loadLeafletMap();
    loadGroups();
    loadSpeciesLists();
}

/*
 * Initiate Leaflet map
 */
function loadLeafletMap() {
    var leaflet = (window.L && window.L.maplibreGL) ? window.L : (window.L_mainMap || window.L);
    if (leaflet.Google && MAP_VAR.googleApiKey) {
        leaflet.Google.apiKey = MAP_VAR.googleApiKey;
    }
    var latLng = leaflet.latLng($('#latitude').val(), $('#longitude').val());

    if (!MAP_VAR.map) {
        var defaultBaseLayer;
        if (MAP_VAR.mapMinimalVectorTileUrl && typeof leaflet.maplibreGL === 'function') {
            try {
                var vectorOptions = {
                    style: MAP_VAR.mapMinimalVectorTileUrl,
                    pane: 'tilePane',
                    zIndex: 0
                };
                if (MAP_VAR.mapMinimalAttribution) {
                    vectorOptions.attributionControl = { customAttribution: MAP_VAR.mapMinimalAttribution };
                }
                defaultBaseLayer = leaflet.maplibreGL(vectorOptions);
            } catch (e) {
                console.warn("Failed to initialize MapLibre GL layer, falling back to raster tiles:", e);
            }
        }
        if (!defaultBaseLayer) {
            defaultBaseLayer = leaflet.tileLayer(MAP_VAR.mapMinimalUrl, {
            attribution: MAP_VAR.mapMinimalAttribution,
            subdomains: MAP_VAR.mapMinimalSubdomains
        });
        }

        MAP_VAR.baseLayers = {
            "Minimal": defaultBaseLayer,
            "Road":  new L.Google('ROADMAP'),
            //"Terrain": new L.Google('TERRAIN'),
            "Satellite": new L.Google('HYBRID')
        };

        MAP_VAR.map = leaflet.map('mapCanvas', {
            center: latLng,
            zoom: MAP_VAR.zoom,
            scrollWheelZoom: false
        });

        updateMarkerPosition(latLng);

        // add layer control (layerControl is not a leaflet var)
        MAP_VAR.layerControl = leaflet.control.layers(MAP_VAR.baseLayers).addTo(MAP_VAR.map);

        MAP_VAR.map.on('baselayerchange', function(event) {
            $.cookie('map.baseLayer', event.name, { path: '/' });
            if (event.layer && typeof event.layer.bringToBack === 'function') {
                event.layer.bringToBack();
            }
            if (event.name === 'Minimal' && event.layer === defaultBaseLayer && typeof defaultBaseLayer.getMaplibreMap === 'function') {
                var glMap = defaultBaseLayer.getMaplibreMap();
                if (glMap) {
                    glMap.once('error', handleVectorFallback);
                }
            }
            if (alaWmsLayer && typeof alaWmsLayer.bringToFront === 'function') {
                alaWmsLayer.bringToFront();
            }
        });

        function handleVectorFallback(err) {
            console.warn("MapLibre GL error encountered, falling back to raster tiles:", err);
            var wasActive = MAP_VAR.map && MAP_VAR.map.hasLayer(defaultBaseLayer);
            if (wasActive) {
                MAP_VAR.map.removeLayer(defaultBaseLayer);
            }
            var fallbackLayer = leaflet.tileLayer(MAP_VAR.mapMinimalUrl, {
                attribution: MAP_VAR.mapMinimalAttribution,
                subdomains: MAP_VAR.mapMinimalSubdomains
            });
            if (wasActive) {
                fallbackLayer.addTo(MAP_VAR.map);
                if (typeof fallbackLayer.bringToBack === 'function') {
                    fallbackLayer.bringToBack();
                }
            }
            MAP_VAR.baseLayers["Minimal"] = fallbackLayer;
            if (MAP_VAR.layerControl) {
                MAP_VAR.layerControl.removeLayer(defaultBaseLayer);
                MAP_VAR.layerControl.addBaseLayer(fallbackLayer, "Minimal");
            }
        }

        if (typeof defaultBaseLayer.once === 'function') {
            defaultBaseLayer.once('error', handleVectorFallback);
        }

        // select the user's preferred base layer
        var userBaseLayer = $.cookie('map.baseLayer')
        var baseLayer = MAP_VAR.baseLayers[userBaseLayer]
        if (baseLayer !== undefined) {
            //add the default base layer
            MAP_VAR.map.addLayer(baseLayer);
            if (typeof baseLayer.bringToBack === 'function') {
                baseLayer.bringToBack();
            }
        } else {
            MAP_VAR.map.addLayer(defaultBaseLayer);
            if (typeof defaultBaseLayer.bringToBack === 'function') {
                defaultBaseLayer.bringToBack();
            }
        }

        if (typeof defaultBaseLayer.getMaplibreMap === 'function') {
            var glMap = defaultBaseLayer.getMaplibreMap();
            if (glMap) {
                glMap.once('error', handleVectorFallback);
            }
        }

        // "locate me" button
        leaflet.easyButton( '<i class="fa fa-location-arrow" data-toggle="tooltip" data-placement="right"></i>', function(e){
            attemptGeolocation();
        },"Use my location").addTo(MAP_VAR.map);

    } else {
        // map loaded already
        // reset layers/markers
        MAP_VAR.layerControl.removeLayer(marker); // prevent duplicate controls
        if (MAP_VAR.map.hasLayer(circle)) MAP_VAR.map.removeLayer(circle);
        if (MAP_VAR.map.hasLayer(marker)) MAP_VAR.map.removeLayer(marker);
        marker = null;
        circle = null;
    }

    // Fix for asset pipeline confusing Leaflet WRT to path to images
    // Leaflet 1.x appends the file name directly, so the path needs a trailing slash
    L.Icon.Default.imagePath = MAP_VAR.mapIconUrlPath.replace(/\/?$/, '/');

    // Add marker
    marker = L.marker(latLng, {
        title: 'Marker Location',
        draggable: true
    }).addTo(MAP_VAR.map);

    //MAP_VAR.layerControl.removeLayer(marker); // prevent duplicate controls
    MAP_VAR.layerControl.addOverlay(marker, 'Marker');

    markerInfowindow = marker.bindPopup('<div class="infoWindow">marker address</div>',
        {autoClose: true}
    );

    // Add a Circle overlay to the map.
    radius = parseInt($('select#radius').val()) * 1010;
    var circleProps = {
        //radius: radius, leaflet 1+ uses this syntax
        stroke: true,
        weight: 2,
        color: 'black',
        opacity: 0.2,
        fillColor: '#888', // '#2C48A6'
        fillOpacity: 0.2,
        zIndex: -10
    }

    circle = L.circle(latLng, radius, circleProps).addTo(MAP_VAR.map);

    // detect click event and trigger record info popup
    circle.on("click", function (event) {
        pointLookupClickRegister(event);
    });

    // bind circle to marker
    marker.on('dragend', function(e){
        var coords = e.target.getLatLng();
        var lat = coords.lat.toFixed(coordinatePrecision);
        var lon = coords.lng.toFixed(coordinatePrecision);
        var newLatLng = L.latLng(lat, lon);
        MAP_VAR.map.panTo({lon:lon,lat:lat})
        MAP_VAR.map.removeLayer(circle);
        circleProps.radius = radius;
        circle = L.circle([lat, lon], radius, circleProps).addTo(MAP_VAR.map);
        updateMarkerAddress('Drag ended');
        updateMarkerPosition(newLatLng);
        geocodePosition(newLatLng);
        loadGroups();

        // adjust map view for new location
        MAP_VAR.map.setView(latLng, MAP_VAR.zoom);
        MAP_VAR.layerControl.removeLayer(marker); // prevent duplicate controls
    });

    // adjust map view for new location
    MAP_VAR.map.setView(latLng, MAP_VAR.zoom);

    // Update current position info.
    geocodePosition(latLng);
    updateMarkerPosition(latLng);
}

var pendingGeocodePos = null;

/**
 * Load the Google Maps API on demand (via the Leaflet Google plugin loader) and create the geocoder.
 * Without a key no geocoder is created; address lookups are then skipped.
 */
function initGeocoder() {
    var leaflet = window.L && window.L.maplibreGL ? window.L : (window.L_mainMap || window.L);
    if (!MAP_VAR.hasGoogleKey || !leaflet.Google || !leaflet.Google.loadGoogleMaps) {
        return;
    }
    leaflet.Google.loadGoogleMaps(MAP_VAR.googleApiKey, function() {
        geocoder = new google.maps.Geocoder();
        if (pendingGeocodePos) {
            var pos = pendingGeocodePos;
            pendingGeocodePos = null;
            geocodePosition(pos);
        }
    });
}

/**
 * Google geocode function
 */
function geocodePosition(pos) {
    if (!geocoder) {
        // Maps API not loaded (yet): geocode once it is
        pendingGeocodePos = pos;
        return;
    }
    var gLatLng = new google.maps.LatLng(pos.lat, pos.lng); // convert leaflet LatLng to Google LatLng

    geocoder.geocode({
        latLng: gLatLng
    }, function(responses) {
        if (responses && responses.length > 0) {
            var address = responses[0].formatted_address;
            updateMarkerAddress(address);
            // update the info window for marker icon
            var content = '<div class="infoWindow"><b>Location:</b><br/>'+address+'</div>';
            markerInfowindow.bindPopup(content);
        } else {
            updateMarkerAddress('Cannot determine address at this location.');
        }
    });
}

/**
 * Update the "address" hidden input and display span
 */
function updateMarkerAddress(str) {
    $('#markerAddress').empty().html(str);
    $('#location').val(str);
    $('#dialog-confirm code').html(str); // download popup text
}

/**
 * Update the lat & lon hidden input elements
 */
function updateMarkerPosition(latLng) {
    var lat = latLng.lat.toFixed(coordinatePrecision);
    var lng = latLng.lng.toFixed(coordinatePrecision);
    // store values in hidden fields
    $('#latitude').val(lat);
    $('#longitude').val(lng);
    $('#dialog-confirm #rad').html(MAP_VAR.radius);
    MAP_VAR.query = "?q=*%3A*&lat=" + lat + "&lon=" + lng + "&radius=" + MAP_VAR.radius;
}

function loadRecordsLayerForSpeciesGroup(retry){
    var speciesGroupParam = "species_group:" + (speciesGroup === "ALL_SPECIES" ? "*" : speciesGroup);
    loadRecordsLayer(retry, speciesGroupParam);
}

function loadRecordsLayerForSpeciesList(retry){
    var speciesListParam = "species_list_uid:" + (speciesListDrUid.length === 0 ? "*" : speciesListDrUid);
    loadRecordsLayer(retry, speciesListParam);
}

/**
 * Load (reload) geoJSON data into vector layer
 */
function loadRecordsLayer(retry, fqParam) {
    if (!MAP_VAR.map && !retry) {
        // in case a callback calls this function before map has initialised
        setTimeout(function() {if (!points || points.length === 0) {loadRecordsLayer(true, fqParam)}}, 2000);
        return;
    } else if (!MAP_VAR.map) {
        return;
    }

    // Update URL hash for back button, etc
    location.hash = $('#latitude').val() + "|" + $('#longitude').val() + "|" + MAP_VAR.zoom + "|" + speciesGroup;

    // remove any existing records layers and controls
    if (alaWmsLayer) {
        MAP_VAR.map.removeLayer(alaWmsLayer);
        MAP_VAR.layerControl.removeLayer(alaWmsLayer);
        //MAP_VAR.layerControl.removeLayer(marker); // prevent duplicate controls
    }

    // URL for GeoJSON web service
    var alaParams = jQuery.param({
        q: (taxon) ? "taxon_name:\"" + taxon + "\"" : "*:*",
        lat: $('#latitude').val(),
        lon: $('#longitude').val(),
        radius: $('#radius').val(),
        fq: [ "spatiallyValid:true",
              fqParam
        ],
        qc: MAP_VAR.queryContext
    }, true);

    // records popups need to know the species group
    MAP_VAR.removeFqs = "&fq=" + fqParam + "&fq=taxon_name:" + (taxon ? ("\"" + taxon + "\""): "*");

    var alaMapUrl = MAP_VAR.biocacheServiceUrl + "/ogc/wms/reflect?" + alaParams;
    var pointColour = MAP_VAR.pointColour;
    var wmsParams = {
        layers: 'ALA:occurrences',
        format: 'image/png',
        transparent: true,
        attribution: "Atlas of Living Australia",
        bgcolor:"0x000000",
        outline:"false",
        GRIDDETAIL: 32, // 64 || 32
        ENV: "color:" + pointColour + ";name:circle;size:4;opacity:0.7",
        uppercase: true,
        zIndex: 10
    };

    // JQuery AJAX call
    alaWmsLayer = L.tileLayer.wms(alaMapUrl, wmsParams).addTo(MAP_VAR.map);
    if (typeof alaWmsLayer.bringToFront === 'function') {
        alaWmsLayer.bringToFront();
    }
    MAP_VAR.layerControl.addOverlay(alaWmsLayer, 'Records');

    alaWmsLayer.on('tileload', function(te){
        // populate points array, so we can tell if data is loaded - legacy from geoJson version
        points.push(te.url);
    });
}

/**
 * Try to get a lat/long using HTML5 geolocation API
 */
function attemptGeolocation() {
    // HTML5 GeoLocation
    if (navigator && navigator.geolocation) {
        function getMyPosition(position) {
            updateMarkerPosition(L.latLng(position.coords.latitude, position.coords.longitude));
            initialize();
        }

        function positionWasDeclined() {
            alert('Geolocation request was declined or failed due to an error. Try searching for your address using the search box above the map.');
            // scroll window so search bar is visible
            $('html, body').animate({
                scrollTop: $("#searchForm").offset().top - 120 // banner offset 120px
            }, 1000);

            updateMarkerPosition(L.latLng($('#latitude').val(), $('#longitude').val()));
            //LoadTaxaGroupCounts();
            initialize();
        }

        navigator.geolocation.getCurrentPosition(getMyPosition, positionWasDeclined);

        // Neither functions gets called for some reason, so I've added a delay to initialize map anyway
        setTimeout(function() {if (!MAP_VAR.map) positionWasDeclined();}, 9000);
    } else if (typeof google !== 'undefined' && google.loader && google.loader.ClientLocation) {
        // Google AJAX API fallback GeoLocation
        updateMarkerPosition(L.latLng(google.loader.ClientLocation.latitude, google.loader.ClientLocation.longitude));
        initialize();
    } else {
        MAP_VAR.zoom = 12;
        initialize();
    }
}

/**
 * Reverse geocode coordinates via Google Maps API
 */
function geocodeAddress(reverseGeocode) {
    var address = $('input#address').val();
    var latLng = null;

    // Check if input contains a comma and try and parse coordinates
    if (address && address.indexOf(",") > -1 && magellan) {
        var parts = address.split(",");
        var lat = magellan(parts[0].trim()).latitude(); //.toDD();
        var lng = magellan(parts[1].trim()).longitude(); //.toDD();

        if (lat && lng) {
            latLng = L.latLng(lat.toDD(), lng.toDD());
            updateMarkerAddress("GPS coordinates: " + lat.toDD() + ", " + lng.toDD());
            updateMarkerPosition(latLng);
            // reload map pin, etc
            initialize();
            loadRecordsLayerForSpeciesGroup(false);
        }

    }

    if (!latLng && geocoder && address) {
        geocoder.geocode( {'address': address, region: MAP_VAR.geocodeRegion}, function(results, status) {
            if (status === google.maps.GeocoderStatus.OK) {
                // geocode was successful
                updateMarkerAddress(results[0].formatted_address);
                var gLatLng = results[0].geometry.location;
                var latLng = L.latLng(gLatLng.lat(), gLatLng.lng());
                updateMarkerPosition(latLng);
                // reload map pin, etc
                initialize();
                loadRecordsLayerForSpeciesGroup(false);
            } else {
                alert("Geocode was not successful for the following reason: " + status);
            }
        });
    } else {
        initialize();
    }
}

/**
 * Geocode location via Google Maps API
 */
function addAddressToPage(response) {
    if (!response || response.Status.code !== 200) {
        alert("Sorry, we were unable to geocode that address");
    } else {
        var location = response.Placemark[0];
        var lat = location.Point.coordinates[1]
        var lon = location.Point.coordinates[0];
        var locationStr = location.address;
        updateMarkerAddress(locationStr);
        updateMarkerPosition(L.latLng(lat, lon));
    }
}

var globalOffsetMap = new Map([
    ['rightList', 0],
    ['rightListSL', 0]
]);
var globalSortOrder
var globalJsonMap = new Map([
    ['rightList', []],
    ['rightListSL', []]
]);
var dataRequest
var lastParameters

function getGlobalOffset(tab){
    return globalOffsetMap.get(tab)
}

function setGlobalOffset(tab, value){
    globalOffsetMap.set(tab, value)
}

function getJson(tab){
    return globalJsonMap.get(tab)
}

function setJson(tab, value){
    return globalJsonMap.set(tab, value)
}

function getActiveTabId() {
    const activeTab = document.querySelector('.tab-pane.active');
    return activeTab ? activeTab.id : null;
}

/**
 * Species group was clicked
 */
function groupClicked(el) {

    var speciesJson = getJson('rightList')
    var globalOffset = getGlobalOffset('rightList')
    // Change the global var speciesGroup
    speciesGroup = $(el).find('a.taxonBrowse').attr('id');
    taxon = null; // clear any species click
    taxonGuid = null;
    $('#taxa-level-0 tr').removeClass("activeRow");
    $(el).addClass("activeRow");
    $('#taxa-level-1 tbody tr').addClass("activeRow");
    // update records page link text - if no list is selected, show "all", otherwise "selected"
    if (speciesGroup === "ALL_SPECIES") {
        $("#recordsGroupText").text("all");
    } else {
        $("#recordsGroupText").text("selected");
    }
    // update links to downloads and records list
    if (MAP_VAR.map) loadRecordsLayerForSpeciesGroup(false)
    // AJAX...
    var uri = MAP_VAR.biocacheServiceUrl + "/explore/group/"+speciesGroup + "?includeRank=false";
    var sortField = "count"
    var params = {
        lat: $('#latitude').val(),
        lon: $('#longitude').val(),
        radius: $('#radius').val(),
        fq: "spatiallyValid:true",
        qc: MAP_VAR.queryContext,
        sort: sortField,
        pageSize: -1
    };

    // clone params and speciesGroup
    var allParameters = $.extend({speciesGroup: speciesGroup}, params)

    // debounce to fix location.hash trigger issue
    if (lastParameters && JSON.stringify(allParameters) === JSON.stringify(lastParameters)) {
        return
    } else {
        lastParameters = allParameters
        speciesJson = [] // flow continues, so clear out old data for AJAX call below
        setJson('rightList', speciesJson)
    }

    $('#rightList tbody').empty();
    $(".scrollContent").scrollTop(0);

    $('#spinnerRow').show();
    $("div#rightList").data("sort", sortField); // save 'sort' value to the DOM
    var currentGroup = speciesGroup

    if (dataRequest) {
        dataRequest.abort();
    }
    dataRequest = $.getJSON(uri, params, function(data) {
        $('#spinnerRow').hide();

        // global store
        speciesJson = data
        setJson('rightList', speciesJson)
        globalOffset = 0
        setGlobalOffset('rightList', globalOffset)

        sortSpeciesJson(speciesJson)

        // process JSON data from request
        if (data) processSpeciesJsonData(data, currentGroup, "rightList");
    });
}

/**
 * Species group was clicked
 */
function speciesListClicked(el) {

    var speciesListJson = getJson('rightListSL')
    var globalOffset = getGlobalOffset('rightListSL')
    // Change the global var speciesGroup
    speciesListDrUid = $(el).find('a.taxonBrowse').attr('id'); // TODO narrow down to a tab
    taxon = null; // clear any species click
    taxonGuid = null;
    $('#taxa-level-0-sl tr').removeClass("activeRow");
    $(el).addClass("activeRow");
    // update records page link text - always show "selected" for species lists, as they are all "selected" lists
    $("#recordsGroupText").text("selected");
    // update links to downloads and records list
    if (MAP_VAR.map) {
        loadRecordsLayerForSpeciesList(false)
    }
    // AJAX...
    var uri = MAP_VAR.biocacheServiceUrl + "/explore/specieslist/"+speciesListDrUid + "?includeRank=false";
    var sortField = "count"
    var params = {
        lat: $('#latitude').val(),
        lon: $('#longitude').val(),
        radius: $('#radius').val(),
        fq: "spatiallyValid:true",
        qc: MAP_VAR.queryContext,
        sort: sortField,
        pageSize: -1
    };

    // clone params and speciesGroup
    var allParameters = $.extend({speciesList: speciesListDrUid}, params)

    // debounce to fix location.hash trigger issue
    if (lastParameters && JSON.stringify(allParameters) === JSON.stringify(lastParameters)) {
        return
    } else {
        lastParameters = allParameters
        speciesListJson = [] // flow continues, so clear out old data for AJAX call below
        setJson('rightListSL', speciesListJson)
    }

    $('#rightListSL tbody').empty();
    $(".scrollContent").scrollTop(0);

    $('#spinnerRowSL').show();
    $("div#rightListSL").data("sort", sortField); // save 'sort' value to the DOM
    var currentSpeciesList = speciesListDrUid

    if (dataRequest) {
        dataRequest.abort();
    }
    dataRequest = $.getJSON(uri, params, function(data) {
        $('#spinnerRowSL').hide();

        // global store
        speciesListJson = data
        setJson('rightListSL', speciesListJson)
        globalOffset = 0
        setGlobalOffset('rightListSL', globalOffset)

        sortSpeciesJson(speciesListJson)

        // process JSON data from request
        if (data) processSpeciesJsonData(data, currentSpeciesList, "rightListSL");
    });
}

/**
 * Process the JSON data from a species list AJAX request (species in area)
 */
function processSpeciesJsonData(data, currentSelection, rightListElementId) {
    var offset = getGlobalOffset(rightListElementId)
    var pageSize = 50;

    var contents = ""

    // process JSON data
    if (data.length > 0) {
        var lastRow = $('#' + rightListElementId + ' tbody tr').length;
        var linkTitle = "display on map";
        var infoTitle = "view species page";
        var recsTitle = "view list of records";
        // iterate over list of species from search
        for (var i = offset; i < data.length && i < offset + pageSize; i++) {
            // create new table row
            var count = i;
            // add count
            var tr = '<tr><td class="speciesIndex">'+(count+1)+'.</td>';
            const sciName = data[i].name;
            const commonName = data[i].commonName;
            const taxonGuid = data[i].guid;
            // add common name
            if (commonName) {
                tr = tr + '<td class="sciName">' + commonName +'</td>';
            } else {
                tr = tr + ' <td class="sciName"> [Not supplied] </td>';
            }
            // add scientific name
            tr = tr + '<td class="sciName"><a id="' + taxonGuid + '" class="taxonBrowse2" title="'+linkTitle+'" href="'+ // id=taxon_name
                sciName+'"><i>'+sciName+'</i></a>';

            // add links to species page and occurrence search (inside hidden div)
            if(MAP_VAR.speciesPageUrl) {
                var speciesInfo = '<div class="speciesInfo">';
                if (taxonGuid) {
                    speciesInfo = speciesInfo + '<a class="speciesPageLink" title="' + infoTitle + '" href="' + MAP_VAR.speciesPageUrl + taxonGuid +
                        '"><img src="' + MAP_VAR.imagesUrlPrefix + '/page_white_go.png" alt="species page icon" style="margin-bottom:-3px;" class="no-rounding"/>' +
                        ' species profile</a> | ';
                }
                speciesInfo = speciesInfo + '<a href="' + MAP_VAR.contextPath + '/occurrences/search?q=taxon_name:%22' + sciName +
                    '%22&lat=' + $('input#latitude').val() + '&lon=' + $('input#longitude').val() + '&radius=' + $('select#radius').val() + '" title="' +
                    recsTitle + '"><img src="' + MAP_VAR.imagesUrlPrefix + '/database_go.png" ' +
                    'alt="search list icon" style="margin-bottom:-3px;" class="no-rounding"/> list of records</a></div>';
                tr = tr + speciesInfo;
            }
            // add number of records
            tr = tr + '</td><td class="rightCounts">' + data[i].count + ' </td></tr>';
            // write list item to page
            contents += tr
        }

        $('#loadMoreSpecies').remove();

        if (offset + pageSize < data.length) {
            // add load more link
            var sortOrder = $("div#" + rightListElementId + "").data("sort") ? $("div#" + rightListElementId + "").data("sort") : "index";
            contents += '<tr id="loadMoreSpecies"><td>&nbsp;</td><td colspan="2"><a ' +
                'data-sort="'+sortOrder+'" data-offset="' + (offset + pageSize) + '">Show more species</a></td></tr>';
        }

        // globalOffset += pageSize
        setGlobalOffset(rightListElementId, getGlobalOffset(rightListElementId) + pageSize)
    } else {
        // no species were found (either via paging or clicking on taxon group
        var text = '<tr><td></td><td colspan="2">[no species found]</td></tr>';
        contents += text;
    }

    // only add to page if the group has not changed
    if (currentSelection !== undefined && currentSelection !== speciesGroup && currentSelection !== speciesListDrUid) {
        return
    }

    $('#' + rightListElementId + ' tbody').append(contents);

    // Register clicks for the list of species links so that map changes
    $('#' + rightListElementId + ' tbody tr').unbind('click.specieslink')
    $('#' + rightListElementId + ' tbody tr').bind('click.specieslink', function(e) {
        e.preventDefault(); // ignore the href text - used for data
        var thisTaxonA = $(this).find('a.taxonBrowse2').attr('href').split('/');
        var thisTaxon = thisTaxonA[thisTaxonA.length-1].replace(/%20/g, ' ');
        var guid = $(this).find('a.taxonBrowse2').attr('id');
        taxonGuid = guid;
        taxon = thisTaxon; // global var so map can show just this taxon
        $('#' + rightListElementId + ' tbody tr').removeClass("activeRow2"); // un-highlight previous current taxon
        // remove previous species info row
        $('#' + rightListElementId + ' tbody tr#info').detach();
        var info = $(this).find('.speciesInfo').html();
        // copy contents of species into a new (tmp) row
        if (info) {
            $(this).after('<tr id="info"><td><td>'+info+'<td></td></tr>');
        }
        // hide previous selected spceies info box
        $(this).addClass("activeRow2"); // highloght current taxon
        // show the links for current selected species
        if (rightListElementId.endsWith('SL')) {
            loadRecordsLayerForSpeciesList(false)
        } else {
            loadRecordsLayerForSpeciesGroup(false)
        }
    });

    // Register onClick for "load more species" link & sort headers
    $('#loadMoreSpecies a').unbind('click.sort')
    $('#loadMoreSpecies a').bind('click.sort', function(e) {
            e.preventDefault(); // ignore the href text - used for data

            // process JSON data from request
            processSpeciesJsonData(getJson(rightListElementId), currentSelection, rightListElementId);
        }
    );
    $('thead.fixedHeader a').bind('click.sort', function(e) {
            e.preventDefault(); // ignore the href text - used for data
            globalSortOrder = $(this).data("sort") ? $(this).data("sort") : "count";

            sortSpeciesJson();

            $('#' + rightListElementId + ' tbody').empty();
            $(".scrollContent").scrollTop(0);

            // globalOffset = 0
            setGlobalOffset(rightListElementId, 0)

            // process JSON data from request
            processSpeciesJsonData(getJson(rightListElementId), currentSelection, rightListElementId);
        }
    );

    // add hover effect to table cell with scientific names
    $('#' + rightListElementId + ' tbody tr').hover(
        function() {
            $(this).addClass('hoverCell');
        },
        function() {
            $(this).removeClass('hoverCell');
        }
    );
}

function sortSpeciesJson(json) {
    if (globalSortOrder === "common") {
        json.sort(function (a,b) {
            if (a.commonName === b.commonName) return 0

            // sort missing common name to the end
            if (a.commonName === '') return 1
            if (b.commonName === '') return -1
            return (a.commonName < b.commonName ? -1 : 1)
        })
    } else if (globalSortOrder === "taxa") {
        json.sort(function (a,b) {
            return (a.name === b.name) ? 0 : (a.name < b.name ? -1 : 1)
        })
    } else {
        json.sort(function (a,b) {
            return (a.count === b.count) ? 0 : (a.count < b.count ? 1 : -1)
        })
    }
}

/*
 * Perform normal spatial search for species groups and species counts
 */
function loadGroups() {
    var url = MAP_VAR.biocacheServiceUrl +"/explore/groups";
    var params = {
        lat: $('#latitude').val(),
        lon: $('#longitude').val(),
        radius: $('#radius').val(),
        fq: "spatiallyValid:true",
        facets: "species_group",
        qc: MAP_VAR.queryContext
    }

    $.getJSON(url, params, function(data) {
        if (data) {
            populateSpeciesGroups(data);
        }
    });
}

/*
 * Perform normal spatial search for species lists and species counts per list
 */
function loadSpeciesLists() {
    var url = MAP_VAR.biocacheServiceUrl + "/explore/specieslists";
    var params = {
        lat: $('#latitude').val(),
        lon: $('#longitude').val(),
        radius: $('#radius').val(),
        fq: "spatiallyValid:true",
        facets: "species_list_uid",
        qc: MAP_VAR.queryContext
    }

    $.getJSON(url, params, function(data) {
        if (data) {
            populateSpeciesLists(data);
        }
    });
    $('#spinnerRowSL').hide(); // hide spinner on first load as there's no default species list to load
    $('#taxa-level-0-sl tbody tr:first td:first a').click(); // select first species list by default
}

/*
 * Populate the species group column (via callback from AJAX)
 */
function populateSpeciesGroups(data) {
    if (data.length > 0) {
        $("#taxa-level-0 tbody").empty(); // clear existing values
        $.each(data, function (i, n) {
            addGroupRow(n.name, n.speciesCount, n.level)
        });

        // Dynamically set height of #taxaDiv (to match containing div height)
        var tableHeight = $('#taxa-level-0').height();
        $('.tableContainer').height(tableHeight+2);
        var tbodyHeight = $('#taxa-level-0 tbody').height();
        $('#rightList tbody').height(tbodyHeight);
        $('#taxa-level-0 tbody tr.activeRow').click();
    }

    function addGroupRow(group, count, indent) {
        var label = camelCase(group);
        if (group === "ALL_SPECIES") label = "all.species";
        var rc = (group === speciesGroup) ? " class='activeRow'" : ""; // highlight active group
        var i18nLabel = jQuery.i18n.prop(label);

        var h = "<tr"+rc+" title='click to view group on map'><td class='indent"+indent+"'><a href='#' id='"+group+"' " +
            "class='taxonBrowse' title='click to view group on map'>"+i18nLabel+"</a></td><td>"+count+"</td></tr>";
        $("#taxa-level-0 tbody").append(h);
    }
}

/*
 * Populate the species lists tab column (via callback from AJAX)
 */
function populateSpeciesLists(data) {
    if (data.length > 0) {
        $("#taxa-level-0-sl tbody").empty(); // clear existing values
        $.each(data, function (i, n) {
            addSpeciesListRow(n.drUid, n.name, n.speciesCount)
        });

        // Dynamically set height of #taxaDiv (to match containing div height)
        var tableHeight = $('#taxa-level-0-sl').height();
        $('.tableContainer').height(tableHeight+2);
        var tbodyHeight = $('#taxa-level-0-sl tbody').height();
        $('#rightList tbody').height(tbodyHeight);
    }

    function addSpeciesListRow(speciesListDruid, speciesListName, count) {
        var label = speciesListName;
        var rc = (speciesListName === speciesGroup) ? " class='activeRow'" : ""; // TODO - highlight active species list
        var speciesListUrl = MAP_VAR.speciesListBaseUrl + "/speciesListItem/list/" + speciesListDruid;

        var h = "<tr" + rc
            + " title='click to view species list on map'><td class='indent0'><a href='#' id='" + speciesListDruid + "' "
            + "class='taxonBrowse' title='click to view species list on map'>" + label + "</a>"
            + "<a href='" + speciesListUrl + "' " +
            "target='_blank' " +
            "class='external-link' " +
            "rel='noopener noreferrer' " +
            "title='Open conservation list details' " +
            "onclick='event.stopPropagation();'>" +
            "<i class='fa-solid fa-up-right-from-square'></i>" +
            "</a>"
            + "</td><td>" + count + "</td></tr>";
        $("#taxa-level-0-sl tbody").append(h);
    }
}

// Function to convert into camel Case
function camelCase(str) {
    // Using replace method with regEx
    const word = str.replace(/(?:^\w|[A-Z]|\b\w)/g, function (word, index) {
        return index === 0 ? word.toLowerCase() : word.toUpperCase();
    }).replace(/\s+/g, '');
    return word[0].toUpperCase() + word.substring(1);
}

function bookmarkedSearch(lat, lng, zoom1, group) {
    MAP_VAR.radius = radiusForZoom[zoom1];  // set global var
    MAP_VAR.zoom = parseInt(zoom1);
    $('select#radius').val(MAP_VAR.radius); // update drop-down widget
    if (group) speciesGroup = group;
    updateMarkerPosition(L.latLng(lat, lng));
    // load map and groups
    initialize();
}

//
function loadStateFromHash(encodedHash) {
    // update map state from URL hash
    // e.g. #-35.2512|149.1630|12|ALL_SPECIES
    var hashParts = encodedHash.split("%7C"); // note escaped version of |
    if (hashParts.length === 3) {
        bookmarkedSearch(hashParts[0], hashParts[1], hashParts[2], null);
    } else if (hashParts.length === 4) {
        // not sure what is going on with the selected species group encoding, but this works
        bookmarkedSearch(hashParts[0], hashParts[1], hashParts[2], decodeURIComponent(decodeURIComponent(hashParts[3])));
    } else {
        attemptGeolocation();
    }
}

function getEncodedHash() {
    // hash coding: #lat|lng|zoom
    var hash = window.location.hash.replace( /^#/, '');
    var encodedHash;

    if (hash.indexOf("%7C") !== -1) {
        // already escaped
        encodedHash = hash;
    } else {
        // escape used to prevent injection attacks
        encodedHash = encodeURIComponent(hash);
    }

    return encodedHash;
}
