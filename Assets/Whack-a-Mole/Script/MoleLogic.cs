using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class MoleLogic : MonoBehaviour
{

    Camera camera;

    private int spot;
    private int wait;
    private bool down;
    private int hits;
    public GameObject center;
    public Text text;

    // Start is called before the first frame update
    void Start()
    {
        camera = Camera.main;
        spot = Random.Range(1, 10);
        PositionMole();
        wait = 180;
        down = false;
        hits = 0;
    }

    // Update is called once per frame
    void Update()
    {
        Vector3 mousepos = Input.mousePosition;
        Vector3 mouseworldpos = camera.ScreenToWorldPoint(new Vector3(mousepos.x, mousepos.y, camera.nearClipPlane));
        
        if (Input.GetMouseButton(0) && !down)
        {
            if (Mathf.Sqrt(((center.transform.position.x - (mouseworldpos.x * 32f)) * (center.transform.position.x - (mouseworldpos.x * 32f))) + (((mouseworldpos.y * 32f) - center.transform.position.y) * ((mouseworldpos.y * 32f) - center.transform.position.y))) < 0.12f)
            {
                hits++;
            }
            down = true;
        }

        if (!Input.GetMouseButton(0))
        {
            down = false;
        }

        wait--;
        
        if (wait == 0)
        {
            wait = 180;
            spot = Random.Range(1, 10);
            PositionMole();
        }

        text.text = "Hits : " + hits;
    }

    void PositionMole()
    {
        switch (spot)
        {
            case 1:
                this.transform.position = new Vector3(0.641f, -0.41f, -1.497f);
                break;
            case 2:
                this.transform.position = new Vector3(0.141f, -0.41f, -1.497f);
                break;
            case 3:
                this.transform.position = new Vector3(-0.359f, -0.41f, -1.497f);
                break;
            case 4:
                this.transform.position = new Vector3(0.641f, -0.91f, -1.497f);
                break;
            case 5:
                this.transform.position = new Vector3(0.141f, -0.91f, -1.497f);
                break;
            case 6:
                this.transform.position = new Vector3(-0.359f, -0.91f, -1.497f);
                break;
            case 7:
                this.transform.position = new Vector3(0.641f, -1.41f, -1.497f);
                break;
            case 8:
                this.transform.position = new Vector3(0.141f, -1.41f, -1.497f);
                break;
            case 9:
                this.transform.position = new Vector3(-0.359f, -1.41f, -1.497f);
                break;
        }
    }
}
