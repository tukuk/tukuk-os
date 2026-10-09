// GameMain.cs — kerangka Unity (OPT-IN, manual build).
//
// Kenapa BUKAN laluan auto-harian: Unity perlukan editor berlesen + build yang
// berat (minit CI terhad). Untuk "1 hari 1 app+game" secara percuma tanpa membebankan
// server, laluan web (Phaser) ialah default. Gunakan scaffold ini hanya bila anda
// memang mahu game "serius": import fail ini ke projek Unity, cipta Scene, dan
// attach class ini ke satu GameObject kosong.
using UnityEngine;

public class GameMain : MonoBehaviour
{
    public string theme = "{{WORD}}";
    public int score = 0;
    public GameObject collectible;   // prefab bertema "{{WORD}}"
    public float spawnInterval = 0.9f;
    public float spawnXRange = 4f;
    private float _timer;

    void Update()
    {
        _timer += Time.deltaTime;
        if (_timer >= spawnInterval && collectible != null)
        {
            _timer = 0f;
            var pos = new Vector3(Random.Range(-spawnXRange, spawnXRange), 5f, 0f);
            Instantiate(collectible, pos, Quaternion.identity);
        }
    }

    public void Collect()
    {
        score++;
        Debug.Log($"{theme} score={score}");
    }
}
