import 'dart:async';
import 'dart:io';
import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mototaxi_atacames/costa_go_campaigns.dart';

class _Headers extends Fake implements HttpHeaders {
  @override
  void add(String name, Object value, {bool preserveHeaderCase = false}) {}
}

class _Response extends Stream<List<int>> implements HttpClientResponse {
  _Response(this.bytes);
  final List<int> bytes;
  @override
  int get statusCode => 200;
  @override
  int get contentLength => bytes.length;
  @override
  HttpClientResponseCompressionState get compressionState =>
      HttpClientResponseCompressionState.notCompressed;
  @override
  StreamSubscription<List<int>> listen(void Function(List<int>)? onData,
          {Function? onError, void Function()? onDone, bool? cancelOnError}) =>
      Stream<List<int>>.value(bytes).listen(onData,
          onError: onError, onDone: onDone, cancelOnError: cancelOnError);
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _Request extends Fake implements HttpClientRequest {
  _Request(this.bytes);
  final List<int> bytes;
  @override
  HttpHeaders get headers => _Headers();
  @override
  Future<HttpClientResponse> close() async => _Response(bytes);
}

class _Client extends Fake implements HttpClient {
  _Client(this.bytes, this.urls);
  final List<int> bytes;
  final List<String> urls;
  @override
  set autoUncompress(bool value) {}
  @override
  Future<HttpClientRequest> getUrl(Uri url) async {
    urls.add(url.toString());
    return _Request(bytes);
  }
}

void main() {
  testWidgets(
      'theme assets replace live without loading main on Home, and detail uses main',
      (tester) async {
    final bytes =
        (await rootBundle.load('assets/campaigns/header/summer_detail.png'))
            .buffer
            .asUint8List();
    final urls = <String>[];
    debugNetworkImageHttpClientProvider = () => _Client(bytes, urls);
    addTearDown(() => debugNetworkImageHttpClientProvider = null);
    var item = <String, dynamic>{
      'id': 'dynamic',
      'version': 1,
      'title': 'Bienvenida',
      'variant': 'CUSTOM',
      'decorateHeader': true,
      'headerDecorationMode': 'EDGES',
      'startsAt':
          DateTime.now().subtract(const Duration(hours: 1)).toIso8601String(),
      'endsAt': DateTime.now().add(const Duration(hours: 1)).toIso8601String(),
      'assets': [
        'THUMBNAIL',
        'THUMBNAIL_DARK',
        'MAIN',
        'DARK',
        'HEADER',
        'HEADER_DARK'
      ],
      'placements': ['HOME'],
      'ctaType': 'NONE'
    };
    final store = CostaGoCampaignStore(
        load: () async => {
              'items': [item]
            },
        detail: (_) async => item,
        imageUrl: (c, k) => 'https://example.test/dynamic/$k?v=${c['version']}',
        headers: const {});
    await HttpOverrides.runZoned(() async {
      Future<void> render(Brightness brightness, {bool detail = false}) async {
        await tester.pumpWidget(MaterialApp(
            theme: ThemeData(brightness: brightness),
            home: Scaffold(
                body: Column(children: [
              CostaGoCampaignHeaderDecoration(
                  store: store,
                  child: const SizedBox(
                      width: 320, height: 80, child: Text('Hola, Usuario'))),
              if (detail)
                CampaignImage(store: store, campaign: item)
              else
                CostaGoHomeCampaigns(store: store, onAction: (_, __) async {}),
            ]))));
        await tester.runAsync(
            () => Future<void>.delayed(const Duration(milliseconds: 150)));
        await tester.pumpAndSettle();
        await tester.runAsync(
            () => Future<void>.delayed(const Duration(milliseconds: 150)));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
      }

      await render(Brightness.light);
      expect(urls, contains('https://example.test/dynamic/HEADER?v=1'));
      expect(urls, contains('https://example.test/dynamic/THUMBNAIL?v=1'));
      expect(
          urls.any((u) => u.contains('/MAIN') || u.contains('/DARK')), isFalse);
      await render(Brightness.dark);
      expect(urls, contains('https://example.test/dynamic/HEADER_DARK?v=1'));
      expect(urls, contains('https://example.test/dynamic/THUMBNAIL_DARK?v=1'));
      item = {...item, 'version': 2, 'headerDecorationMode': 'FULL_OVERLAY'};
      await store.refresh(force: true);
      await render(Brightness.dark);
      expect(urls, contains('https://example.test/dynamic/HEADER_DARK?v=2'));
      await render(Brightness.dark, detail: true);
      expect(urls, contains('https://example.test/dynamic/DARK?v=2'));
      item = {...item, 'version': 3, 'assets': <String>[]};
      await store.refresh(force: true);
      await render(Brightness.dark, detail: true);
      expect(find.byType(Image), findsNothing);
      await tester.pumpWidget(const SizedBox());
      store.dispose();
    }, createHttpClient: (_) => _Client(bytes, urls));
    debugNetworkImageHttpClientProvider = null;
  });
  testWidgets(
      'loaded thumbnail and custom decoration use their distinct backend assets',
      (tester) async {
    final bytes =
        (await rootBundle.load('assets/campaigns/header/summer_detail.png'))
            .buffer
            .asUint8List();
    final urls = <String>[];
    debugNetworkImageHttpClientProvider = () => _Client(bytes, urls);
    addTearDown(() => debugNetworkImageHttpClientProvider = null);
    final campaign = <String, dynamic>{
      'id': 'loaded',
      'title': 'Campaña cargada',
      'variant': 'CUSTOM',
      'decorateHeader': true,
      'startsAt':
          DateTime.now().subtract(const Duration(hours: 1)).toIso8601String(),
      'endsAt': DateTime.now().add(const Duration(hours: 1)).toIso8601String(),
      'assets': ['MAIN', 'DARK', 'THUMBNAIL', 'DECORATION'],
      'placements': ['HOME'],
      'ctaType': 'NONE'
    };
    final store = CostaGoCampaignStore(
        load: () async => {
              'items': [campaign]
            },
        detail: (_) async => campaign,
        headers: const {'authorization': 'Bearer fixture'},
        imageUrl: (_, kind) => 'https://example.test/loaded/$kind');
    await HttpOverrides.runZoned(() async {
      await tester.pumpWidget(MaterialApp(
          home: Scaffold(
              body: Column(children: [
        CostaGoCampaignHeaderDecoration(
            store: store, child: const CircleAvatar()),
        CostaGoHomeCampaigns(store: store, onAction: (_, __) async {}),
      ]))));
      await tester.runAsync(() async {
        await Future<void>.delayed(const Duration(milliseconds: 150));
      });
      await tester.pumpAndSettle();
      await tester.runAsync(() async {
        await Future<void>.delayed(const Duration(milliseconds: 150));
      });
      await tester.pumpAndSettle();
      expect(urls, contains('https://example.test/loaded/THUMBNAIL'));
      expect(urls, contains('https://example.test/loaded/DECORATION'));
      expect(find.byType(RawImage), findsNWidgets(2));
      for (final raw in tester.widgetList<RawImage>(find.byType(RawImage))) {
        expect(raw.image, isNotNull);
      }
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      store.dispose();
    }, createHttpClient: (_) => _Client(bytes, urls));
    debugNetworkImageHttpClientProvider = null;
  });
}
