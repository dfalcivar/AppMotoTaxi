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
      'loaded thumbnail and custom decoration use their distinct backend assets',
      (tester) async {
    final bytes =
        (await rootBundle.load('assets/campaigns/header/summer_detail.png'))
            .buffer
            .asUint8List();
    final urls = <String>[];
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
  });
}
