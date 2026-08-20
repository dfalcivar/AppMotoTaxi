import 'dart:async';

import 'package:flutter/material.dart';

enum AffiliateBannerVariant { expanded, compact }

class AffiliateBanners extends StatefulWidget {
  const AffiliateBanners({
    super.key,
    required this.load,
    required this.imageUrl,
    this.variant = AffiliateBannerVariant.expanded,
    this.onTap,
    this.onAvailabilityChanged,
    this.rotationSeconds = 5,
    this.onImpression,
  });

  final Future<List<dynamic>> Function() load;
  final String Function(Map<String, dynamic> banner) imageUrl;
  final AffiliateBannerVariant variant;
  final ValueChanged<Map<String, dynamic>>? onTap;
  final ValueChanged<bool>? onAvailabilityChanged;
  final int rotationSeconds;
  final ValueChanged<Map<String, dynamic>>? onImpression;

  @override
  State<AffiliateBanners> createState() => _AffiliateBannersState();
}

class _AffiliateBannersState extends State<AffiliateBanners> {
  static const fallbackBanner = <String, dynamic>{
    'id': 'costa-go-default-advertising',
    'title': 'Tu publicidad aquí',
    'placement': 'PASSENGER_SEARCHING_DRIVER',
    'actionType': 'NONE',
    'isFallback': true,
    'weight': 1,
  };
  final controller = PageController();
  List<Map<String, dynamic>> banners = [];
  Timer? rotation;
  Timer? refresh;
  Timer? impressionDelay;
  int page = 0;
  bool? lastAvailability;
  String? lastImpressionKey;

  @override
  void initState() {
    super.initState();
    reload();
    refresh = Timer.periodic(const Duration(minutes: 5), (_) => reload());
    rotation = Timer.periodic(Duration(seconds: widget.rotationSeconds), (_) {
      if (!mounted || banners.length < 2 || !controller.hasClients) return;
      page = (page + 1) % banners.length;
      controller.animateToPage(page,
          duration: const Duration(milliseconds: 450), curve: Curves.easeInOut);
      reportImpression(page);
    });
  }

  void reportAvailability(bool available) {
    if (lastAvailability == available) return;
    lastAvailability = available;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) widget.onAvailabilityChanged?.call(available);
    });
  }

  Future<void> reload() async {
    try {
      final result = await widget.load();
      if (!mounted) return;
      final source =
          result.map((item) => Map<String, dynamic>.from(item as Map)).toList();
      final weighted = <Map<String, dynamic>>[];
      final maximumWeight = source.length <= 1
          ? 1
          : source.fold<int>(1, (value, banner) {
              final weight =
                  ((banner['weight'] as num?)?.toInt() ?? 1).clamp(1, 5);
              return weight > value ? weight : value;
            });
      for (var round = 0; round < maximumWeight; round++) {
        for (final banner in source) {
          final weight = ((banner['weight'] as num?)?.toInt() ?? 1).clamp(1, 5);
          if (round < weight) weighted.add(banner);
        }
      }
      setState(() {
        banners = weighted.isEmpty
            ? [Map<String, dynamic>.from(fallbackBanner)]
            : weighted;
        if (page >= banners.length) page = 0;
      });
      reportAvailability(source.isNotEmpty);
      reportImpression(page);
    } catch (_) {
      // La publicidad no bloquea el flujo principal si la red falla.
      if (mounted && banners.isEmpty) {
        setState(() => banners = [Map<String, dynamic>.from(fallbackBanner)]);
      }
      reportAvailability(banners.any((banner) => banner['isFallback'] != true));
    }
  }

  void reportImpression(int index) {
    if (index < 0 || index >= banners.length) return;
    impressionDelay?.cancel();
    impressionDelay = Timer(const Duration(seconds: 1), () {
      if (!mounted || page != index || index >= banners.length) return;
      final banner = banners[index];
      if (banner['isFallback'] == true) return;
      final key =
          '${banner['id']}-$index-${DateTime.now().millisecondsSinceEpoch ~/ (widget.rotationSeconds * 1000)}';
      if (lastImpressionKey == key) return;
      lastImpressionKey = key;
      widget.onImpression?.call(banner);
    });
  }

  @override
  void dispose() {
    rotation?.cancel();
    refresh?.cancel();
    impressionDelay?.cancel();
    controller.dispose();
    super.dispose();
  }

  Widget bannerImage(Map<String, dynamic> banner, {BoxFit fit = BoxFit.cover}) {
    if (banner['isFallback'] == true) {
      return Image.asset('assets/images/advertising-placeholder.png', fit: fit);
    }
    return Image.network(
      widget.imageUrl(banner),
      fit: fit,
      semanticLabel: banner['title']?.toString(),
      errorBuilder: (_, __, ___) =>
          Image.asset('assets/images/advertising-placeholder.png', fit: fit),
    );
  }

  Widget expandedBanner(BuildContext context, Map<String, dynamic> banner) {
    final scheme = Theme.of(context).colorScheme;
    final hasLink = banner['actionType']?.toString() != 'NONE' &&
        (banner['actionValue']?.toString().trim().isNotEmpty == true ||
            banner['targetUrl']?.toString().trim().isNotEmpty == true);
    return Material(
      color: scheme.surfaceContainer,
      borderRadius: BorderRadius.circular(18),
      clipBehavior: Clip.antiAlias,
      elevation: 2,
      child: InkWell(
        onTap: hasLink && widget.onTap != null
            ? () => widget.onTap!(banner)
            : null,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          AspectRatio(
            aspectRatio: 3,
            child: ColoredBox(
              color: scheme.surfaceContainerHighest,
              child: SizedBox(
                  width: double.infinity,
                  child: bannerImage(banner, fit: BoxFit.contain)),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 9, 10, 9),
            child: Row(children: [
              Expanded(
                child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text('Comercio afiliado',
                          style: Theme.of(context)
                              .textTheme
                              .labelSmall
                              ?.copyWith(color: scheme.onSurfaceVariant)),
                      Text(banner['title']?.toString() ?? 'Promoción cercana',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontWeight: FontWeight.w700)),
                    ]),
              ),
              if (hasLink)
                TextButton(
                    onPressed: () => widget.onTap?.call(banner),
                    child: const Text('Ver promoción')),
            ]),
          ),
        ]),
      ),
    );
  }

  Widget compactBanner(BuildContext context, Map<String, dynamic> banner) {
    final scheme = Theme.of(context).colorScheme;
    final hasLink = banner['actionType']?.toString() != 'NONE' &&
        (banner['actionValue']?.toString().trim().isNotEmpty == true ||
            banner['targetUrl']?.toString().trim().isNotEmpty == true);
    return Material(
      color: scheme.surface,
      borderRadius: BorderRadius.circular(18),
      clipBehavior: Clip.antiAlias,
      elevation: 5,
      shadowColor: Colors.black38,
      child: InkWell(
        onTap: hasLink && widget.onTap != null
            ? () => widget.onTap!(banner)
            : null,
        child: Row(children: [
          SizedBox(width: 112, height: 78, child: bannerImage(banner)),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text('Comercio afiliado',
                        style: Theme.of(context)
                            .textTheme
                            .labelSmall
                            ?.copyWith(color: scheme.onSurfaceVariant)),
                    const SizedBox(height: 2),
                    Text(banner['title']?.toString() ?? 'Promoción cercana',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w700)),
                  ]),
            ),
          ),
          if (hasLink)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: Icon(Icons.open_in_new, size: 20, color: scheme.primary),
            ),
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (banners.isEmpty) return const SizedBox.shrink();
    final compact = widget.variant == AffiliateBannerVariant.compact;
    return LayoutBuilder(builder: (context, constraints) {
      final expandedHeight = constraints.maxWidth / 3 + 58;
      return SizedBox(
        height: compact ? 78 : expandedHeight,
        child: PageView.builder(
          controller: controller,
          itemCount: banners.length,
          onPageChanged: (value) {
            page = value;
            reportImpression(value);
          },
          itemBuilder: (context, index) => compact
              ? compactBanner(context, banners[index])
              : expandedBanner(context, banners[index]),
        ),
      );
    });
  }
}
