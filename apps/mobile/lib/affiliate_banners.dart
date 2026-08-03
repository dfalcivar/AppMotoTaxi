import 'dart:async';

import 'package:flutter/material.dart';

class AffiliateBanners extends StatefulWidget {
  const AffiliateBanners(
      {super.key, required this.load, required this.imageUrl});

  final Future<List<dynamic>> Function() load;
  final String Function(Map<String, dynamic> banner) imageUrl;

  @override
  State<AffiliateBanners> createState() => _AffiliateBannersState();
}

class _AffiliateBannersState extends State<AffiliateBanners> {
  final controller = PageController();
  List<Map<String, dynamic>> banners = [];
  Timer? rotation;
  Timer? refresh;
  int page = 0;

  @override
  void initState() {
    super.initState();
    reload();
    refresh = Timer.periodic(const Duration(minutes: 5), (_) => reload());
    rotation = Timer.periodic(const Duration(seconds: 8), (_) {
      if (!mounted || banners.length < 2 || !controller.hasClients) return;
      page = (page + 1) % banners.length;
      controller.animateToPage(page,
          duration: const Duration(milliseconds: 450), curve: Curves.easeInOut);
    });
  }

  Future<void> reload() async {
    try {
      final result = await widget.load();
      if (!mounted) return;
      setState(() {
        banners = result
            .map((item) => Map<String, dynamic>.from(item as Map))
            .toList();
        if (page >= banners.length) page = 0;
      });
    } catch (_) {
      // La publicidad no bloquea el flujo principal si la red falla.
    }
  }

  @override
  void dispose() {
    rotation?.cancel();
    refresh?.cancel();
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: 6),
          child: Text(
              banners.isEmpty ? 'Espacio publicitario' : 'Comercio afiliado',
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant)),
        ),
        AspectRatio(
          aspectRatio: 3,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: banners.isEmpty
                ? Image.asset('assets/images/advertising-placeholder.png',
                    fit: BoxFit.cover, semanticLabel: 'Tu publicidad aquí')
                : PageView.builder(
                    controller: controller,
                    itemCount: banners.length,
                    onPageChanged: (value) => page = value,
                    itemBuilder: (context, index) => Image.network(
                      widget.imageUrl(banners[index]),
                      fit: BoxFit.cover,
                      semanticLabel: banners[index]['title']?.toString(),
                      errorBuilder: (_, __, ___) => Image.asset(
                          'assets/images/advertising-placeholder.png',
                          fit: BoxFit.cover),
                    ),
                  ),
          ),
        ),
      ]),
    );
  }
}
