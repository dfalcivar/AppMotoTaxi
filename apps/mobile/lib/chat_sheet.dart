import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';

import 'realtime_service.dart';

Future<void> showTripChat({
  required BuildContext context,
  required String tripId,
  required String userId,
  required RealtimeService realtime,
  required Future<List<dynamic>> Function() loadHistory,
  required Future<dynamic> Function(String clientMessageId, String body)
      sendFallback,
}) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => FractionallySizedBox(
        heightFactor: .88,
        child: _TripChat(
          tripId: tripId,
          userId: userId,
          realtime: realtime,
          loadHistory: loadHistory,
          sendFallback: sendFallback,
        ),
      ),
    );

class _TripChat extends StatefulWidget {
  const _TripChat({
    required this.tripId,
    required this.userId,
    required this.realtime,
    required this.loadHistory,
    required this.sendFallback,
  });

  final String tripId;
  final String userId;
  final RealtimeService realtime;
  final Future<List<dynamic>> Function() loadHistory;
  final Future<dynamic> Function(String clientMessageId, String body)
      sendFallback;

  @override
  State<_TripChat> createState() => _TripChatState();
}

class _TripChatState extends State<_TripChat> {
  final input = TextEditingController();
  final scroll = ScrollController();
  final List<Map<String, dynamic>> messages = [];
  StreamSubscription<Map<String, dynamic>>? subscription;
  bool loading = true;
  bool sending = false;

  static const quickReplies = [
    'Ya llegué',
    'Estoy en la entrada',
    'Voy en camino',
    'No encuentro el punto',
    'Espérame un momento',
  ];

  @override
  void initState() {
    super.initState();
    subscription = widget.realtime.events.listen(_event);
    widget.realtime.subscribeTrip(widget.tripId);
    widget.realtime.markRead(widget.tripId);
    _load();
  }

  Future<void> _load() async {
    try {
      final loaded = await widget.loadHistory();
      if (!mounted) return;
      setState(() {
        messages
          ..clear()
          ..addAll(loaded.map((item) => Map<String, dynamic>.from(item)));
        loading = false;
      });
      _bottom();
    } catch (_) {
      if (mounted) setState(() => loading = false);
    }
  }

  void _event(Map<String, dynamic> event) {
    if (!mounted) return;
    if (event['type'] == 'chat:message') {
      final value = Map<String, dynamic>.from(event['message'] as Map);
      if (value['tripId'] != widget.tripId) return;
      value['mine'] = value['senderId'] == widget.userId;
      _add(value);
    } else if (event['type'] == 'chat:ack') {
      final value = Map<String, dynamic>.from(event['message'] as Map);
      if (value['tripId'] != widget.tripId) return;
      value['mine'] = true;
      _add(value);
    } else if (event['type'] == 'chat:read' &&
        event['tripId'] == widget.tripId) {
      setState(() {
        for (final message in messages) {
          if (message['mine'] == true) message['readAt'] = event['readAt'];
        }
      });
    }
  }

  void _add(Map<String, dynamic> value) {
    final id = value['id']?.toString();
    if (id != null && messages.any((item) => item['id']?.toString() == id)) {
      return;
    }
    setState(() => messages.add(value));
    widget.realtime.markRead(widget.tripId);
    _bottom();
  }

  void _bottom() => WidgetsBinding.instance.addPostFrameCallback((_) {
        if (scroll.hasClients) {
          scroll.animateTo(scroll.position.maxScrollExtent,
              duration: const Duration(milliseconds: 250),
              curve: Curves.easeOut);
        }
      });

  String _uuid() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex =
        bytes.map((value) => value.toRadixString(16).padLeft(2, '0')).join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
        '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }

  Future<void> _send([String? quick]) async {
    final body = (quick ?? input.text).trim();
    if (body.isEmpty || sending) return;
    setState(() => sending = true);
    input.clear();
    final clientId = _uuid();
    try {
      if (!widget.realtime.sendMessage(widget.tripId, clientId, body)) {
        final message = await widget.sendFallback(clientId, body);
        _add(Map<String, dynamic>.from(message as Map)..['mine'] = true);
      }
    } finally {
      if (mounted) setState(() => sending = false);
    }
  }

  @override
  void dispose() {
    subscription?.cancel();
    input.dispose();
    scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Column(children: [
        ListTile(
          leading: const CircleAvatar(child: Icon(Icons.chat_bubble_outline)),
          title: const Text('Chat del viaje'),
          subtitle: const Text('Conversa sin compartir tu número personal'),
          trailing: IconButton(
            icon: const Icon(Icons.close),
            onPressed: () => Navigator.pop(context),
          ),
        ),
        SizedBox(
          height: 46,
          child: ListView.separated(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            scrollDirection: Axis.horizontal,
            itemCount: quickReplies.length,
            separatorBuilder: (_, __) => const SizedBox(width: 8),
            itemBuilder: (_, index) => ActionChip(
              label: Text(quickReplies[index]),
              onPressed: () => _send(quickReplies[index]),
            ),
          ),
        ),
        const Divider(),
        Expanded(
          child: loading
              ? const Center(child: CircularProgressIndicator())
              : messages.isEmpty
                  ? const Center(child: Text('Todavía no hay mensajes.'))
                  : ListView.builder(
                      controller: scroll,
                      padding: const EdgeInsets.all(12),
                      itemCount: messages.length,
                      itemBuilder: (_, index) {
                        final message = messages[index];
                        final mine = message['mine'] == true;
                        return Align(
                          alignment: mine
                              ? Alignment.centerRight
                              : Alignment.centerLeft,
                          child: Container(
                            constraints: const BoxConstraints(maxWidth: 290),
                            margin: const EdgeInsets.only(bottom: 8),
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: mine
                                  ? Theme.of(context)
                                      .colorScheme
                                      .primaryContainer
                                  : Theme.of(context)
                                      .colorScheme
                                      .surfaceContainerHighest,
                              borderRadius: BorderRadius.circular(16),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                if (!mine)
                                  Text(message['senderName']?.toString() ?? '',
                                      style: Theme.of(context)
                                          .textTheme
                                          .labelSmall),
                                Text(message['body']?.toString() ?? ''),
                                if (mine)
                                  Align(
                                    alignment: Alignment.centerRight,
                                    child: Icon(
                                      message['readAt'] == null
                                          ? Icons.done
                                          : Icons.done_all,
                                      size: 15,
                                    ),
                                  ),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
        ),
        Padding(
          padding: EdgeInsets.only(
            left: 12,
            right: 12,
            top: 8,
            bottom: MediaQuery.viewInsetsOf(context).bottom + 8,
          ),
          child: Row(children: [
            Expanded(
              child: TextField(
                controller: input,
                maxLength: 500,
                minLines: 1,
                maxLines: 4,
                decoration: const InputDecoration(
                  hintText: 'Escribe un mensaje',
                  counterText: '',
                ),
                onSubmitted: (_) => _send(),
              ),
            ),
            const SizedBox(width: 8),
            IconButton.filled(
              onPressed: sending ? null : _send,
              icon: const Icon(Icons.send),
            ),
          ]),
        ),
      ]);
}
