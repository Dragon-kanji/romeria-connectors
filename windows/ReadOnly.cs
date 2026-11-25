// Copyright 2026 Romeria. Licence Apache 2.0.
// Lecture GATT bornée. Les seuls descripteurs écrits activent les notifications.
// Aucun WriteValue, aucun point de contrôle, aucun handshake propriétaire.
using System.Text;
using System.Text.Json;
using Windows.Devices.Bluetooth;
using Windows.Devices.Bluetooth.GenericAttributeProfile;
using Windows.Storage.Streams;

namespace Ashiato.Ftms;

internal static partial class Program
{
    private sealed class ReadLink : IDisposable
    {
        public required BluetoothLEDevice Device;
        public readonly List<GattDeviceService> Services = [];
        public readonly List<(GattCharacteristic Characteristic, Windows.Foundation.TypedEventHandler<GattCharacteristic, GattValueChangedEventArgs> Handler)> Listeners = [];
        public Windows.Foundation.TypedEventHandler<BluetoothLEDevice, object>? Lost;
        public void Dispose()
        {
            if (Lost is not null) Device.ConnectionStatusChanged -= Lost;
            foreach (var (characteristic, handler) in Listeners) characteristic.ValueChanged -= handler;
            foreach (var service in Services) service.Dispose();
            Device.Dispose();
        }
    }
    private static ReadLink? _readLink;
    private static void CloseReadLink() { _readLink?.Dispose(); _readLink = null; }

    private static bool IsData(Guid service, Guid characteristic) =>
        (service == Short(0x1826) && characteristic == Short(0x2acd)) ||
        (service == Short(0x1814) && characteristic == Short(0x2a53)) ||
        (service == Short(0xfe00) && characteristic == Short(0xfe02)) ||
        (service == Short(0xfff0) && characteristic == Short(0xfff1)) ||
        (service == Short(0xffe0) && characteristic == Short(0xffe1)) ||
        (service == Short(0xae00) && characteristic == Short(0xae01));

    private static byte[] Bytes(IBuffer buffer)
    {
        using var reader = DataReader.FromBuffer(buffer);
        var bytes = new byte[buffer.Length];
        reader.ReadBytes(bytes);
        return bytes;
    }

    private static async Task Inspect(JsonElement message, int? id, bool keep)
    {
        var address = message.TryGetProperty("address", out var a) ? a.GetString() : null;
        var profile = message.TryGetProperty("profile", out var p) ? p.GetString() : "diagnostic";
        if (address is null || !TryParseAddress(address, out var numeric)) { Error("adresse Bluetooth invalide", id); return; }
        // La connexion permanente est exclusivement celle d'un capteur RSC.
        if (keep && profile != "rsc") { Error("read-connect demande le profil rsc", id); return; }
        CloseReadLink();
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(25));
        var token = deadline.Token;
        ReadLink? link = null;
        var servicesSeen = new List<string>();
        var characteristicsSeen = new List<string>();
        var packets = new List<(string Service, string Characteristic, string Hex)>();
        var errors = new List<string>();
        string? model = null;
        string? manufacturer = null;
        string deviceName = "";
        var packetLock = new object();
        try
        {
            var device = await BluetoothLEDevice.FromBluetoothAddressAsync(numeric).AsTask(token);
            if (device is null) throw new InvalidOperationException("appareil indisponible");
            link = new ReadLink { Device = device };
            deviceName = device.Name;
            var services = await device.GetGattServicesAsync(BluetoothCacheMode.Uncached).AsTask(token);
            if (services.Status != GattCommunicationStatus.Success) throw new InvalidOperationException($"services : {services.Status}");
            link.Services.AddRange(services.Services);
            foreach (var service in services.Services)
            {
                servicesSeen.Add(service.Uuid.ToString());
                if (keep && service.Uuid != Short(0x1814)) continue;
                var chars = await service.GetCharacteristicsAsync(BluetoothCacheMode.Uncached).AsTask(token);
                if (chars.Status != GattCommunicationStatus.Success) { errors.Add($"{service.Uuid} : {chars.Status}"); continue; }
                foreach (var characteristic in chars.Characteristics)
                {
                    characteristicsSeen.Add(characteristic.Uuid.ToString());
                    if (!keep && service.Uuid == Short(0x180a) && (characteristic.Uuid == Short(0x2a24) || characteristic.Uuid == Short(0x2a29)) && characteristic.CharacteristicProperties.HasFlag(GattCharacteristicProperties.Read))
                    {
                        var value = await characteristic.ReadValueAsync(BluetoothCacheMode.Uncached).AsTask(token);
                        if (value.Status == GattCommunicationStatus.Success)
                        {
                            var text = Encoding.UTF8.GetString(Bytes(value.Value));
                            if (characteristic.Uuid == Short(0x2a24)) model = text; else manufacturer = text;
                        }
                    }
                    if (!IsData(service.Uuid, characteristic.Uuid)) continue;
                    void Capture(IBuffer buffer)
                    {
                        var hex = Convert.ToHexStringLower(Bytes(buffer));
                        if (keep) Emit(w => { w.WriteString("event", "notify"); w.WriteString("char", "2a53"); w.WriteString("hex", hex); });
                        else lock (packetLock) { if (packets.Count < 32) packets.Add((service.Uuid.ToString(), characteristic.Uuid.ToString(), hex)); }
                    }
                    if (characteristic.CharacteristicProperties.HasFlag(GattCharacteristicProperties.Read))
                    {
                        var value = await characteristic.ReadValueAsync(BluetoothCacheMode.Uncached).AsTask(token);
                        if (value.Status == GattCommunicationStatus.Success) Capture(value.Value);
                        else errors.Add($"lecture {characteristic.Uuid} : {value.Status}");
                    }
                    if (characteristic.CharacteristicProperties.HasFlag(GattCharacteristicProperties.Notify))
                    {
                        Windows.Foundation.TypedEventHandler<GattCharacteristic, GattValueChangedEventArgs> handler = (_, value) => Capture(value.CharacteristicValue);
                        characteristic.ValueChanged += handler;
                        link.Listeners.Add((characteristic, handler));
                        var result = await characteristic.WriteClientCharacteristicConfigurationDescriptorAsync(GattClientCharacteristicConfigurationDescriptorValue.Notify).AsTask(token);
                        if (result != GattCommunicationStatus.Success) errors.Add($"notifications {characteristic.Uuid} : {result}");
                    }
                }
            }
            if (keep)
            {
                if (link.Listeners.Count == 0 || errors.Count > 0) throw new InvalidOperationException("notifications RSC indisponibles");
                link.Lost = (sender, _) => { if (sender.ConnectionStatus == BluetoothConnectionStatus.Disconnected) Emit(w => { w.WriteString("event", "disconnected"); w.WriteString("reason", "liaison RSC perdue"); }); };
                device.ConnectionStatusChanged += link.Lost;
                _readLink = link;
                link = null;
                Emit(w => { w.WriteString("event", "connected"); w.WriteString("name", deviceName); });
                return;
            }
            var seconds = message.TryGetProperty("seconds", out var s) ? Math.Clamp(s.GetInt32(), 1, 10) : 5;
            await Task.Delay(TimeSpan.FromSeconds(seconds), token);
        }
        catch (Exception error) { errors.Add(error is OperationCanceledException ? "délai GATT dépassé (25 s)" : error.Message); }
        finally { link?.Dispose(); }
        if (keep) { Error(string.Join(" ; ", errors), id); return; }
        lock (packetLock) EmitInspection(id, address, deviceName, model, manufacturer, servicesSeen, characteristicsSeen, packets, errors);
    }

    // Écriture explicite compatible Native AOT, sans sérialisation dynamique ni réflexion.
    private static void EmitInspection(int? id, string address, string deviceName, string? model, string? manufacturer,
        List<string> services, List<string> characteristics, List<(string Service, string Characteristic, string Hex)> packets, List<string> errors)
    {
        Emit(w =>
        {
            w.WriteString("event", "inspection");
            if (id is { } correlationId) w.WriteNumber("id", correlationId);
            w.WriteString("address", address);
            w.WriteString("name", deviceName);
            w.WriteString("model", model);
            w.WriteString("manufacturer", manufacturer);
            w.WriteStartArray("services"); foreach (var value in services) w.WriteStringValue(value); w.WriteEndArray();
            w.WriteStartArray("characteristics"); foreach (var value in characteristics) w.WriteStringValue(value); w.WriteEndArray();
            w.WriteStartArray("packets");
            foreach (var packet in packets)
            {
                w.WriteStartObject(); w.WriteString("service", packet.Service); w.WriteString("characteristic", packet.Characteristic); w.WriteString("hex", packet.Hex); w.WriteEndObject();
            }
            w.WriteEndArray();
            w.WriteStartArray("errors"); foreach (var value in errors) w.WriteStringValue(value); w.WriteEndArray();
        });
    }
}
